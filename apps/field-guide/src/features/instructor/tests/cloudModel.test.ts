import { createModelInstructor } from '../domain/turn/modelInstructor';
import type { InstructorModel } from '../domain/turn/InstructorModel';
import { INITIAL_SESSION } from '../../guide';
import { evidenceFor } from '../domain/context';
import { fixturePack } from '@tests/fixturePack';
import { ReplyFormat, rulesFor } from '../domain/grounding';
import {
  cloudInstructions,
  createCloudModel,
} from '../data/answerers/cloudModel';
import { fakePlatform, fakeStreamingRequests } from '@tests/platform';
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

test('is not ready offline', () => {
  let online = false;
  const cloud = createCloudModel({
    proxy: createProxyClient(URL, platform),
    clock: () => time,
    timers,
    isOnline: () => online,
  });
  expect(cloud.isReady()).toBe(false);
  online = true;
  expect(cloud.isReady()).toBe(true);
});
