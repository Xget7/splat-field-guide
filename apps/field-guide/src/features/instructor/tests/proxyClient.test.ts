import { fakePlatform, fakeTextStreams } from '@tests/platform';
import type { FakeTextStream } from '@tests/platform';
import type { Fetch, Platform } from '../../../platform/ports';
import {
  createProxyClient,
  PING_TIMEOUT_MS,
  ProxyFailureKind,
} from '../data/proxy/proxyClient';

const URL = 'https://proxy.example';
const QUESTION = { system: 'Rules.', prompt: 'Question: What is it?' };
const line = (event: object) => `${JSON.stringify(event)}\n`;

function proxyWith(ports: Partial<Platform> = {}) {
  const requests = fakeTextStreams();
  const { platform } = fakePlatform({
    streamText: requests.streamText,
    ...ports,
  });
  return { proxy: createProxyClient(URL, platform), requests };
}
const responding = (status: number, body: unknown) =>
  jest.fn(async () => ({
    status,
    json: async () => body,
  })) as unknown as Fetch;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('posts the system and prompt as JSON to the answer route', () => {
  const { proxy, requests } = proxyWith();
  proxy.answer(QUESTION, jest.fn());
  const sent = requests.last;
  expect([sent.method, sent.url]).toEqual(['POST', `${URL}/v1/answer`]);
  expect(sent.headers['Content-Type']).toBe('application/json');
  expect(JSON.parse(sent.body)).toEqual(QUESTION);
});

test('reports the text so far and resolves the full text on done', async () => {
  const { proxy, requests } = proxyWith();
  const onText = jest.fn();
  const answer = proxy.answer(QUESTION, onText);
  requests.last.receive(line({ text: 'It' }) + line({ text: ' supplies.' }));
  requests.last.receive(line({ done: true }));
  requests.last.end();
  await expect(answer.text).resolves.toBe('It supplies.');
  expect(onText.mock.calls).toEqual([['It'], ['It supplies.']]);
  expect(requests.last.aborted).toBe(false);
});

test.each([
  [
    'an error event',
    (sent: FakeTextStream) => sent.receive(line({ error: 'overloaded' })),
    ProxyFailureKind.remoteError,
    'overloaded',
  ],
  [
    'an error alongside done',
    (sent: FakeTextStream) =>
      sent.receive(line({ done: true, error: 'cut off' })),
    ProxyFailureKind.remoteError,
    'cut off',
  ],
  [
    'an error alongside text',
    (sent: FakeTextStream) => {
      sent.receive(line({ text: 'Truncated', error: 'cut off' }));
      sent.receive(line({ done: true }));
    },
    ProxyFailureKind.remoteError,
    'cut off',
  ],
  [
    'an unreadable line',
    (sent: FakeTextStream) => sent.receive('nope\n'),
    ProxyFailureKind.unreadable,
    'unreadable stream',
  ],
  [
    'a null event',
    (sent: FakeTextStream) => sent.receive('null\n'),
    ProxyFailureKind.badEvent,
    'bad event',
  ],
  [
    'a stream without done',
    (sent: FakeTextStream) => {
      sent.receive(line({ text: 'It' }));
      sent.end();
    },
    ProxyFailureKind.endedEarly,
    'stream ended early',
  ],
  [
    'a refused request',
    (sent: FakeTextStream) => sent.end(429),
    ProxyFailureKind.status,
    'status 429',
  ],
  [
    'a network failure',
    (sent: FakeTextStream) => sent.fail(),
    ProxyFailureKind.network,
    'network',
  ],
  [
    'a network failure mid-stream',
    (sent: FakeTextStream) => {
      sent.receive(line({ text: 'It' }));
      sent.fail();
    },
    ProxyFailureKind.network,
    'network',
  ],
  [
    'a cancel',
    (_sent: FakeTextStream, cancel: () => void) => cancel(),
    ProxyFailureKind.cancelled,
    'cancelled',
  ],
])(
  '%s rejects with its kind and aborts',
  async (_case, fail, kind, message) => {
    const { proxy, requests } = proxyWith();
    const answer = proxy.answer(QUESTION, jest.fn());
    fail(requests.last, answer.cancel);
    await expect(answer.text).rejects.toMatchObject({ kind, message });
    expect(requests.last.aborted).toBe(true);
  },
);

test('the signed URL request uses the Worker contract', async () => {
  const fetch = responding(200, { signedUrl: 'wss://fake' });
  const { proxy } = proxyWith({ fetch });
  expect(await proxy.sessionUrl()).toBe('wss://fake');
  expect(fetch).toHaveBeenCalledWith(`${URL}/v1/voice/session`, {
    method: 'POST',
  });
});

test.each([
  [429, { error: 'voice quota' }, 'quota'],
  [429, { error: 'rate limit exceeded' }, 'network'],
  [502, { error: 'voice auth' }, 'auth'],
  [503, { error: 'rate limiter unavailable' }, 'auth'],
  [500, { error: 'unavailable' }, 'network'],
  [200, {}, 'network'],
] as const)(
  'a %s %j session refusal is a %s failure',
  async (status, body, failure) => {
    const { proxy } = proxyWith({ fetch: responding(status, body) });
    await expect(proxy.sessionUrl()).rejects.toThrow(failure);
  },
);

test('an unreachable Worker refuses the session as a network failure', async () => {
  const { proxy } = proxyWith({
    fetch: jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as Fetch,
  });
  await expect(proxy.sessionUrl()).rejects.toThrow('network');
});

test('ping measures a 204 and rejects a bad status or a hanging fetch', async () => {
  const clock = jest.fn().mockReturnValueOnce(100).mockReturnValueOnce(130);
  const answered = proxyWith({ fetch: responding(204, null), clock });
  expect(await answered.proxy.ping()).toBe(30);
  const refused = proxyWith({ fetch: responding(500, null) });
  await expect(refused.proxy.ping()).rejects.toThrow();
  const hanging = proxyWith({
    fetch: jest.fn(() => new Promise(() => {})) as unknown as Fetch,
  }).proxy.ping();
  const failure = hanging.catch((error: Error) => error.message);
  jest.advanceTimersByTime(PING_TIMEOUT_MS);
  expect(await failure).toBe('Network probe failed');
});
