import {
  createNetworkService,
  PROBE_INTERVAL_MS,
  ProbeRetry,
} from '../networkService';
import { GrpcBackoff } from '../backoff';
import type { PathInfo } from '../networkQuality';
import { Transport } from '../networkStatus';
import { fakePlatform } from '@tests/platform';

const { platform } = fakePlatform();
const { timers, random } = platform;

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
    timers,
    random,
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
test('a lost route aborts the probe in flight and ignores its answer', async () => {
  let changed!: (path: PathInfo) => void;
  let resolve!: (ms: number) => void;
  let signal!: AbortSignal;
  const emit = jest.fn();
  const service = createNetworkService({
    paths: {
      start: callback => {
        changed = callback;
      },
      stop: () => {},
    },
    probe: probeSignal => {
      signal = probeSignal;
      return new Promise(done => {
        resolve = done;
      });
    },
    emit,
    timers,
    random,
  });
  service.start();
  changed(route);
  changed({ ...route, satisfied: false, transport: Transport.none });
  expect(signal.aborted).toBe(true);
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
    timers,
    random,
  });
  service.start();
  changed(route);
  await flush();
  await jest.advanceTimersByTimeAsync(ProbeRetry.initialMs);
  await jest.advanceTimersByTimeAsync(
    ProbeRetry.initialMs * GrpcBackoff.MULTIPLIER,
  );
  expect(probe).toHaveBeenCalledTimes(3);
  service.setForeground(false);
  await jest.advanceTimersByTimeAsync(PROBE_INTERVAL_MS * 2);
  expect(probe).toHaveBeenCalledTimes(3);
  probe.mockResolvedValue(100);
  service.setForeground(true);
  await flush();
  await jest.advanceTimersByTimeAsync(ProbeRetry.initialMs);
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
