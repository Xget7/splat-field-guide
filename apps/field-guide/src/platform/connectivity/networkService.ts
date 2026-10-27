import { NetworkQuality, type NetworkStatus } from './networkStatus';
import { createBackoff, type BackoffLimits } from './backoff';
import {
  createQualityEstimator,
  type PathInfo,
  type RoundTrip,
} from './networkQuality';

export const PROBE_INTERVAL_MS = 30000;
export const PROBE_TIMEOUT_MS = 3000;
// Failed probes retry from here up to the interval until the connection is good again.
export const ProbeRetry: BackoffLimits = {
  initialMs: 1000,
  maxMs: PROBE_INTERVAL_MS,
};
export interface PathSource {
  start(onChange: (info: PathInfo) => void): void;
  stop(): void;
}
export interface NetworkServiceOptions {
  readonly paths: PathSource;
  /** Resolves with the round trip in milliseconds; the signal aborts a probe whose answer no longer matters. */
  readonly probe: (signal: AbortSignal) => Promise<number>;
  readonly emit: (status: NetworkStatus) => void;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
  readonly random?: () => number;
}
export interface NetworkService {
  start(): void;
  stop(): void;
  /** While the instructor is open, a good connection is measured every interval. */
  setActive(active: boolean): void;
  /** Probes run only in the foreground, and each return to it probes once. */
  setForeground(foreground: boolean): void;
  report(trip: RoundTrip): void;
}
/**
 * One probe at a time, rescheduled by a single timer after each answer.
 * A new route, the background or stop aborts the probe in flight, so its answer is never recorded.
 */
export function createNetworkService(
  options: NetworkServiceOptions,
): NetworkService {
  const schedule = options.setTimeout ?? setTimeout;
  const cancel = options.clearTimeout ?? clearTimeout;
  const estimator = createQualityEstimator();
  const backoff = createBackoff(ProbeRetry, options.random);
  let started = false;
  let active = false;
  let foreground = true;
  let satisfied = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  let emitted: NetworkStatus | undefined;
  function publish(status: NetworkStatus) {
    if (
      status.quality !== emitted?.quality ||
      status.transport !== emitted?.transport
    ) {
      emitted = status;
      options.emit(status);
    }
  }
  const healthy = () =>
    !estimator.failing() && estimator.current().quality === NetworkQuality.good;
  const canProbe = () => started && satisfied && foreground;
  function record(trip: RoundTrip) {
    const recovered = trip.ok && estimator.failing();
    publish(estimator.sample(trip));
    if (recovered || healthy()) {
      backoff.reset();
    }
  }
  function clearTimer() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }
  function halt() {
    clearTimer();
    inFlight?.abort();
    inFlight = null;
  }
  /** A backoff retry until the connection is good, then the interval while the instructor is open. */
  function scheduleNext() {
    clearTimer();
    if (!canProbe() || inFlight !== null) {
      return;
    }
    const delay = !healthy()
      ? backoff.next()
      : active
      ? PROBE_INTERVAL_MS
      : null;
    if (delay !== null) {
      timer = schedule(probe, delay);
    }
  }
  async function probe() {
    halt();
    if (!canProbe()) {
      return;
    }
    const controller = new AbortController();
    inFlight = controller;
    let trip: RoundTrip;
    try {
      trip = { ok: true, ms: await options.probe(controller.signal) };
    } catch {
      trip = { ok: false };
    }
    if (controller.signal.aborted) {
      return;
    }
    inFlight = null;
    record(trip);
    scheduleNext();
  }
  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      options.paths.start(info => {
        if (!started) {
          return;
        }
        backoff.reset();
        satisfied = info.satisfied;
        publish(estimator.path(info));
        if (satisfied) {
          probe();
        } else {
          halt();
        }
      });
    },
    stop() {
      if (!started) {
        return;
      }
      started = false;
      halt();
      options.paths.stop();
    },
    setActive(value) {
      active = value;
      scheduleNext();
    },
    setForeground(value) {
      const returned = value && !foreground;
      foreground = value;
      if (returned) {
        backoff.reset();
        probe();
      } else if (!value) {
        halt();
      }
    },
    report(trip) {
      // Round trips before the first route have nothing to describe.
      if (started && satisfied) {
        record(trip);
        scheduleNext();
      }
    },
  };
}
const PING_PATH = '/v1/ping';
const HTTP_NO_CONTENT = 204;
const PROBE_FAILED = 'Network probe failed';
export function pingProbe(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): (signal?: AbortSignal) => Promise<number> {
  return async signal => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    const began = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fetchImpl(`${baseUrl}${PING_PATH}`, {
          method: 'GET',
          signal: controller.signal,
        }).then(response => {
          if (response.status !== HTTP_NO_CONTENT) {
            throw new Error(PROBE_FAILED);
          }
          return now() - began;
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(PROBE_FAILED));
          }, PROBE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}
