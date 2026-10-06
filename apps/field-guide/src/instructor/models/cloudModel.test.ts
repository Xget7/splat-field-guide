import { createModelInstructor } from './modelInstructor';
import type { InstructorModel } from './InstructorModel';
import { INITIAL_SESSION } from '../../guide/session';
import { evidenceFor } from '../context';
import { fixturePack } from '../../testing/fixturePack';
import { ReplyFormat, rulesFor } from '../grounding';
import {
  cloudInstructions,
  COOL_OFF_MS,
  createCloudModel,
  FIRST_TEXT_MS,
  TOTAL_MS,
} from './cloudModel';

const pack = fixturePack();
const URL = 'https://proxy.example';
const request = {
  question: 'What does the battery do?',
  evidence: evidenceFor('What does the battery do?', INITIAL_SESSION, pack),
  state: INITIAL_SESSION,
  pack,
  history: [],
};

class FakeRequest {
  static last: FakeRequest;
  status = 0;
  responseText = '';
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body = '';
  aborted = false;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeRequest.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: string) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
  }
  /** Delivers `chunk` as the next bytes of a 200 response. */
  receive(chunk: string) {
    this.status = 200;
    this.responseText += chunk;
    this.onprogress?.();
  }
  end(status = 200) {
    this.status = status;
    this.onload?.();
  }
}

let time = 0;
const model = (url: string | null = URL) =>
  createCloudModel({
    url,
    now: () => time,
    Request: FakeRequest as unknown as typeof XMLHttpRequest,
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
  const sent = FakeRequest.last;
  expect([sent.method, sent.url]).toEqual(['POST', `${URL}/v1/answer`]);
  expect(sent.headers['Content-Type']).toBe('application/json');
  expect(JSON.parse(sent.body)).toEqual({
    system: cloudInstructions(pack),
    prompt: 'Part: Battery\nQuestion: What does the battery do?',
  });
});

test('streams text across chunk boundaries and resolves on done', async () => {
  const onText = jest.fn();
  const reply = model().respond(request, onText);
  const sent = FakeRequest.last;
  sent.receive('{"text":"It sup');
  expect(onText).not.toHaveBeenCalled();
  sent.receive('plies"}\n\n{"text":" the starter."}\n');
  sent.receive(line({ done: true }));
  sent.end();
  await expect(reply).resolves.toBe('It supplies the starter.');
  expect(onText.mock.calls).toEqual([
    ['It supplies'],
    ['It supplies the starter.'],
  ]);
});

test.each([
  [
    'an error event',
    (sent: FakeRequest) => sent.receive(line({ error: 'overloaded' })),
    'overloaded',
  ],
  [
    'an error alongside done',
    (sent: FakeRequest) => sent.receive(line({ done: true, error: 'cut off' })),
    'cut off',
  ],
  [
    'an error alongside text',
    (sent: FakeRequest) => {
      sent.receive(line({ text: 'Truncated', error: 'cut off' }));
      sent.receive(line({ done: true }));
    },
    'cut off',
  ],
  [
    'an unreadable line',
    (sent: FakeRequest) => sent.receive('nope\n'),
    'unreadable stream',
  ],
  ['a null event', (sent: FakeRequest) => sent.receive('null\n'), 'bad event'],
  [
    'a stream without done',
    (sent: FakeRequest) => {
      sent.receive(line({ text: 'It' }));
      sent.end();
    },
    'stream ended early',
  ],
  ['a refused request', (sent: FakeRequest) => sent.end(429), 'status 429'],
  ['a network failure', (sent: FakeRequest) => sent.onerror?.(), 'network'],
])(
  '%s rejects and skips the cloud for a while',
  async (_case, fail, reason) => {
    const cloud = model();
    const reply = cloud.respond(request, jest.fn());
    fail(FakeRequest.last);
    await expect(reply).rejects.toThrow(reason);
    expect(FakeRequest.last.aborted).toBe(true);
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
      FakeRequest.last.receive(line({ text: delta }));
    }
    jest.advanceTimersByTime(FIRST_TEXT_MS);
    expect(cloud.isReady()).toBe(false);
    await expect(reply).rejects.toThrow('no text in time');
  },
);

test('first text stops the first-text timer, not the total one', async () => {
  const reply = model().respond(request, jest.fn());
  FakeRequest.last.receive(line({ text: 'It' }));
  jest.advanceTimersByTime(FIRST_TEXT_MS);
  jest.advanceTimersByTime(TOTAL_MS - FIRST_TEXT_MS);
  await expect(reply).rejects.toThrow('too slow');
});

test('cancel rejects without skipping the cloud afterwards', async () => {
  const cloud = model();
  const reply = cloud.respond(request, jest.fn());
  cloud.cancel();
  await expect(reply).rejects.toThrow('cancelled');
  expect(FakeRequest.last.aborted).toBe(true);
  expect(cloud.isReady()).toBe(true);
  expect(() => cloud.cancel()).not.toThrow();
});

test('a new request stops the one before it', async () => {
  const cloud = model();
  const first = cloud.respond(request, jest.fn());
  const firstRequest = FakeRequest.last;
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
    FakeRequest.last.receive(line({ text: 'Provisional reply.' }));
    if (failure === 'error') {
      FakeRequest.last.receive(line({ error: 'cut off' }));
    } else {
      FakeRequest.last.end();
    }
    await answered;
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'answer',
      answer: { reply: 'It supplies the starter.' },
    });
  },
);
