import type { Fetch } from '../../../platform/ports';
import { fakePlatform } from '@tests/platform';
import { createProxyClient, PING_TIMEOUT_MS } from '../data/proxy/proxyClient';
const URL = 'https://issuer.example';
const responding = (status: number, body: unknown) =>
  jest.fn(async () => ({
    status,
    json: async () => body,
  })) as unknown as jest.MockedFunction<Fetch>;
function proxyWith(overrides: Parameters<typeof fakePlatform>[0] = {}) {
  const { platform } = fakePlatform(overrides);
  return { proxy: createProxyClient(URL, platform) };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

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
  [503, { error: 'rate limiter unavailable' }, 'network'],
  [503, { error: 'voice not configured' }, 'auth'],
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
