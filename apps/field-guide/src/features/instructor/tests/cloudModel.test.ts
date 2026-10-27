import { createModelInstructor } from '../domain/turn/modelInstructor';
import type { InstructorModel } from '../domain/turn/InstructorModel';
import { INITIAL_SESSION } from '../../guide';
import { evidenceFor } from '../domain/context';
import { fixturePack } from '@tests/fixturePack';
import { ReplyFormat, rulesFor } from '../domain/grounding';
import {
  cloudInstructions,
  COOL_OFF_MS,
  createCloudModel,
  FIRST_TEXT_MS,
  TOTAL_MS,
} from '../data/answerers/cloudModel';
import { fakePlatform, fakeStreamingRequests } from '@tests/platform';
import type { FakeStreamingRequest } from '@tests/platform';
import { createProxyClient } from '../data/proxy/proxyClient';

const requests = fakeStreamingRequests();
const { platform } = fakePlatform({ streamingRequest: requests.create });
const { timers } = platform;
const pack = fixturePack();
const URL = 'https://proxy.example';
const request = {
  question: 'What does the battery do?',
  evidence: evidenceFor('What does the battery do?', INITIAL_SESSION, pack),
  state: INITIAL_SESSION,
  pack,
  history: [],
};

let time = 0;
const model = (url: string | null = URL) =>
  createCloudModel({
    proxy: url === null ? null : createProxyClient(url, platform),
    clock: () => time,
    timers,
  });
const line = (event: object) => `${JSON.stringify(event)}\n`;

beforeEach(() => {
  jest.useFakeTimers();
  time = 0;
});
afterEach(() => jest.useRealTimers());

test('instructions are strict structured rules followed by every note and guided check', () => {
  const instructions = cloudInstructions(pack);
  expect(
    instructions.startsWith(rulesFor(pack, ReplyFormat.structured).join('\n')),
  ).toBe(true);
  expect(instructions).toContain(
    'Part: Coolant reservoir (also called coolant tank, expansion tank)',
  );
  expect(instructions).toContain(
    'faults: A battery that keeps going flat needs a charging check.',
  );
  expect(instructions).toContain(
    'Check the coolant level: Step engine-cold Caution: Only with the engine cold. Step locate Step read-level',
  );
});

test('is not ready without a proxy', () => {
  expect(model(null).isReady()).toBe(false);
  expect(model().isReady()).toBe(true);
});

test('posts the instructions and a prompt without notes to the proxy', () => {
  model().respond(request, jest.fn());
  const sent = requests.last;
  expect([sent.method, sent.url]).toEqual(['POST', `${URL}/v1/answer`]);
  expect(sent.headers['Content-Type']).toBe('application/json');
  expect(JSON.parse(sent.body)).toEqual({
    system: cloudInstructions(pack),
    prompt: 'Part: Battery\nQuestion: What does the battery do?',
  });
});

test.each([
  [
    'an error event',
    (sent: FakeStreamingRequest) => sent.receive(line({ error: 'overloaded' })),
    'overloaded',
  ],
  [
    'an error alongside done',
    (sent: FakeStreamingRequest) =>
      sent.receive(line({ done: true, error: 'cut off' })),
    'cut off',
  ],
  [
    'an error alongside text',
    (sent: FakeStreamingRequest) => {
      sent.receive(line({ text: 'Truncated', error: 'cut off' }));
      sent.receive(line({ done: true }));
    },
    'cut off',
  ],
  [
    'an unreadable line',
    (sent: FakeStreamingRequest) => sent.receive('nope\n'),
    'unreadable stream',
  ],
  [
    'a null event',
    (sent: FakeStreamingRequest) => sent.receive('null\n'),
    'bad event',
  ],
  [
    'a stream without done',
    (sent: FakeStreamingRequest) => {
      sent.receive(line({ text: 'It' }));
      sent.end();
    },
    'stream ended early',
  ],
  [
    'a refused request',
    (sent: FakeStreamingRequest) => sent.end(429),
    'status 429',
  ],
  ['a network failure', (sent: FakeStreamingRequest) => sent.fail(), 'network'],
])(
  '%s rejects and skips the cloud for a while',
  async (_case, fail, reason) => {
    const cloud = model();
    const reply = cloud.respond(request, jest.fn());
    fail(requests.last);
    await expect(reply).rejects.toThrow(reason);
    expect(requests.last.aborted).toBe(true);
    expect(cloud.isReady()).toBe(false);
    time = COOL_OFF_MS;
    expect(cloud.isReady()).toBe(true);
  },
);

test.each([undefined, '', ' '])(
  'gives up when no answer text arrives in time: %j',
  async delta => {
    const cloud = model();
    const reply = cloud.respond(request, jest.fn());
    if (delta !== undefined) {
      requests.last.receive(line({ text: delta }));
    }
    jest.advanceTimersByTime(FIRST_TEXT_MS);
    expect(cloud.isReady()).toBe(false);
    await expect(reply).rejects.toThrow('no text in time');
  },
);

test('first text stops the first-text timer, not the total one', async () => {
  const reply = model().respond(request, jest.fn());
  requests.last.receive(line({ text: 'It' }));
  jest.advanceTimersByTime(FIRST_TEXT_MS);
  jest.advanceTimersByTime(TOTAL_MS - FIRST_TEXT_MS);
  await expect(reply).rejects.toThrow('too slow');
});

test('cancel rejects without skipping the cloud afterwards', async () => {
  const cloud = model();
  const reply = cloud.respond(request, jest.fn());
  cloud.cancel();
  await expect(reply).rejects.toThrow('cancelled');
  expect(requests.last.aborted).toBe(true);
  expect(cloud.isReady()).toBe(true);
  expect(() => cloud.cancel()).not.toThrow();
});

test('a new request stops the one before it', async () => {
  const cloud = model();
  const first = cloud.respond(request, jest.fn());
  const firstRequest = requests.last;
  cloud.respond(request, jest.fn());
  await expect(first).rejects.toThrow('cancelled');
  expect(firstRequest.aborted).toBe(true);
});

test.each(['error', 'missing done'])(
  'a streamed remote %s falls back to the next model',
  async failure => {
    const fallback: InstructorModel = {
      isReady: () => true,
      prewarm() {},
      cancel() {},
      respond: async () => 'It supplies the starter.',
    };
    const changed = jest.fn();
    const answered = createModelInstructor([model(), fallback]).ask(
      request,
      changed,
    );
    requests.last.receive(line({ text: 'Provisional reply.' }));
    if (failure === 'error') {
      requests.last.receive(line({ error: 'cut off' }));
    } else {
      requests.last.end();
    }
    await answered;
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'answer',
      answer: { reply: 'It supplies the starter.' },
    });
  },
);

test('offline skips the cloud and a slow first text is not a network failure', async () => {
  let online = false;
  const failure = jest.fn();
  const cloud = createCloudModel({
    proxy: createProxyClient(URL, platform),
    clock: () => time,
    timers,
    isOnline: () => online,
    onFailure: failure,
  });
  expect(cloud.isReady()).toBe(false);
  online = true;
  const reply = cloud.respond(request, jest.fn());
  time = 5000;
  requests.last.receive(line({ text: 'It' }));
  time = 6000;
  requests.last.receive(line({ text: ' supplies' }));
  requests.last.receive(line({ done: true }));
  await reply;
  expect(failure).not.toHaveBeenCalled();
});
