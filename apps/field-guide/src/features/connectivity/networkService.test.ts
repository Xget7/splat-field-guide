import {
  createNetworkService,
  pingProbe,
  PROBE_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
} from './networkService';
import type { PathInfo } from './networkQuality';
import { Transport } from '../events/types';

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
test('path probes immediately, emits only changes and ignores stale results', async () => {
  let changed!: (path: PathInfo) => void;
  let resolve!: (ms: number) => void;
  const paths = {
    start: jest.fn(callback => {
      changed = callback;
    }),
    stop: jest.fn(),
  };
  const probe = jest.fn(
    () =>
      new Promise<number>(done => {
        resolve = done;
      }),
  );
  const emit = jest.fn();
  const service = createNetworkService({ paths, probe, emit });
  service.start();
  changed(route);
  changed(route);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledTimes(1);
  changed({ ...route, satisfied: false, transport: Transport.none });
  resolve(900);
  await flush();
  expect(emit.mock.calls.at(-1)?.[0].quality).toBe('offline');
  service.stop();
  expect(paths.stop).toHaveBeenCalledTimes(1);
});
test('active probes run every thirty seconds without overlap and stop when inactive', async () => {
  let changed!: (path: PathInfo) => void;
  let resolve!: (ms: number) => void;
  const probe = jest.fn(
    () =>
      new Promise<number>(done => {
        resolve = done;
      }),
  );
  const service = createNetworkService({
    paths: {
      start: callback => {
        changed = callback;
      },
      stop: jest.fn(),
    },
    probe,
    emit: jest.fn(),
  });
  service.setActive(true);
  service.start();
  changed(route);
  jest.advanceTimersByTime(PROBE_INTERVAL_MS * 2);
  expect(probe).toHaveBeenCalledTimes(1);
  resolve(100);
  await flush();
  jest.advanceTimersByTime(PROBE_INTERVAL_MS);
  expect(probe).toHaveBeenCalledTimes(2);
  resolve(100);
  await flush();
  service.setActive(false);
  jest.advanceTimersByTime(PROBE_INTERVAL_MS * 2);
  expect(probe).toHaveBeenCalledTimes(2);
  service.stop();
});
test('ping measures a 204 and rejects a bad status or a hanging fetch', async () => {
  const now = jest.fn().mockReturnValueOnce(100).mockReturnValueOnce(130);
  const fetcher = jest.fn(async () => ({
    status: 204,
  })) as unknown as typeof fetch;
  expect(await pingProbe('https://worker', fetcher, now)()).toBe(30);
  expect(fetcher).toHaveBeenCalledWith(
    'https://worker/v1/ping',
    expect.objectContaining({ method: 'GET' }),
  );
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
