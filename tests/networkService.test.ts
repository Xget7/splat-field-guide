import {
  createNetworkService,
  pingProbe,
  PROBE_INTERVAL_MS,
  PROBE_RETRY_MS,
  PROBE_TIMEOUT_MS,
} from '../apps/field-guide/src/features/connectivity/networkService';
import type { PathInfo } from '../apps/field-guide/src/features/connectivity/networkQuality';
import { Transport } from '../apps/field-guide/src/features/events/types';

const route: PathInfo = {
  satisfied: true,
  transport: Transport.wifi,
  downstreamKbps: -1,
  signalLevel: -1,
};
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
test('a path probes immediately and publishes only quality or transport changes', async () => {
  let changed!: (path: PathInfo) => void;
  const emit = jest.fn();
  const service = createNetworkService({
    paths: {
      start: callback => {
        changed = callback;
      },
      stop: () => {},
    },
    probe: async () => 900,
    emit,
  });
  service.start();
  changed(route);
  await flush();
  changed(route);
  await flush();
  changed({ ...route, satisfied: false, transport: Transport.none });
  service.stop();
  changed(route);
  service.report({ ok: true, ms: 100 });
  expect(
    emit.mock.calls.map(([status]) => [status.quality, status.transport]),
  ).toEqual([
    ['good', 'wifi'],
    ['weak', 'wifi'],
    ['offline', 'none'],
  ]);
});
test('an old probe cannot change the offline status of a lost route', async () => {
  let changed!: (path: PathInfo) => void;
  let resolve!: (ms: number) => void;
  const emit = jest.fn();
  const service = createNetworkService({
    paths: {
      start: callback => {
        changed = callback;
      },
      stop: () => {},
    },
    probe: () =>
      new Promise(done => {
        resolve = done;
      }),
    emit,
  });
  service.start();
  changed(route);
  changed({ ...route, satisfied: false, transport: Transport.none });
  resolve(900);
  await flush();
  expect(emit.mock.calls.map(([status]) => status.quality)).toEqual([
    'good',
    'offline',
  ]);
  service.stop();
});
test('failed probes retry with backoff in the foreground until the route answers twice', async () => {
  let changed!: (path: PathInfo) => void;
  const probe = jest.fn().mockRejectedValue(new Error('probe'));
  const emit = jest.fn();
  const service = createNetworkService({
    paths: {
      start: callback => {
        changed = callback;
      },
      stop: () => {},
    },
    probe,
    emit,
  });
  service.start();
  changed(route);
  await flush();
  await jest.advanceTimersByTimeAsync(PROBE_RETRY_MS);
  await jest.advanceTimersByTimeAsync(PROBE_RETRY_MS * 2);
  expect(probe).toHaveBeenCalledTimes(3);
  service.setForeground(false);
  await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 2);
  expect(probe).toHaveBeenCalledTimes(3);
  probe.mockResolvedValue(100);
  service.setForeground(true);
  await flush();
  await jest.advanceTimersByTimeAsync(PROBE_RETRY_MS);
  expect(emit.mock.calls.map(([status]) => status.quality)).toEqual([
    'good',
    'weak',
    'offline',
    'good',
  ]);
  expect(jest.getTimerCount()).toBe(0);
  service.setActive(true);
  await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS);
  expect(probe).toHaveBeenCalledTimes(6);
  service.stop();
  expect(jest.getTimerCount()).toBe(0);
});
test('ping measures a 204 and rejects a bad status or a hanging fetch', async () => {
  const now = jest.fn().mockReturnValueOnce(100).mockReturnValueOnce(130);
  const fetcher = jest.fn(async () => ({
    status: 204,
  })) as unknown as typeof fetch;
  expect(await pingProbe('https://worker', fetcher, now)()).toBe(30);
  await expect(
    pingProbe(
      'https://worker',
      jest.fn(async () => ({ status: 500 })) as unknown as typeof fetch,
    )(),
  ).rejects.toThrow();
  const hanging = pingProbe(
    'https://worker',
    jest.fn(() => new Promise(() => {})) as unknown as typeof fetch,
  )();
  const failure = hanging.catch(error => error.message);
  jest.advanceTimersByTime(PROBE_TIMEOUT_MS);
  expect(await failure).toBe('Network probe failed');
});
