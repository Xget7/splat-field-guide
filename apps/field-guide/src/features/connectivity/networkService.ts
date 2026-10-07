import { NetworkQuality, type NetworkStatus } from '../events/types';
import {
  createQualityEstimator,
  type PathInfo,
  type RoundTrip,
} from './networkQuality';

export const PROBE_INTERVAL_MS = 30000;
export const PROBE_TIMEOUT_MS = 3000;
// Retries double from here up to the interval until the connection is good again.
export const PROBE_RETRY_MS = 1000;
export interface PathSource {
  start(onChange: (info: PathInfo) => void): void;
  stop(): void;
}
export interface NetworkServiceOptions {
  readonly paths: PathSource;
  readonly probe: () => Promise<number>;
  readonly emit: (status: NetworkStatus) => void;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
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
export function createNetworkService(
  options: NetworkServiceOptions,
): NetworkService {
  const schedule = options.setTimeout ?? setTimeout;
  const cancel = options.clearTimeout ?? clearTimeout;
  const estimator = createQualityEstimator();
  let started = false;
  let active = false;
  let foreground = true;
  let satisfied = false;
  let generation = 0;
  let probing = false;
  let probeAgain = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
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
  function record(trip: RoundTrip) {
    const reached = trip.ok && estimator.failing();
    publish(estimator.sample(trip));
    if (reached || healthy()) {
      retries = 0;
    }
  }
  /** Schedules the next probe: a backoff retry until the connection is good, then the interval while active. */
  function plan() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    if (!started || !satisfied || !foreground || probing) {
      return;
    }
    const retry = !healthy();
    const delay = retry
      ? Math.min(PROBE_RETRY_MS * 2 ** retries, PROBE_INTERVAL_MS)
      : active
      ? PROBE_INTERVAL_MS
      : null;
    if (delay !== null) {
      timer = schedule(() => {
        timer = null;
        if (retry) {
          retries++;
        }
        probe();
      }, delay);
    }
  }
  async function probe() {
    if (!started || !satisfied || !foreground) {
      return;
    }
    if (probing) {
      probeAgain = true;
      return;
    }
    probing = true;
    plan();
    const currentGeneration = generation;
    let trip: RoundTrip;
    try {
      trip = { ok: true, ms: await options.probe() };
    } catch {
      trip = { ok: false };
    }
    probing = false;
    if (started && currentGeneration === generation) {
      record(trip);
    }
    if (probeAgain) {
      probeAgain = false;
      probe();
    } else {
      plan();
    }
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
        generation++;
        retries = 0;
        satisfied = info.satisfied;
        publish(estimator.path(info));
        if (satisfied) {
          probe();
        } else {
          plan();
        }
      });
    },
    stop() {
      if (!started) {
        return;
      }
      started = false;
      generation++;
      probeAgain = false;
      options.paths.stop();
      plan();
    },
    setActive(value) {
      active = value;
      plan();
    },
    setForeground(value) {
      const returned = value && !foreground;
      foreground = value;
      if (returned) {
        retries = 0;
        probe();
      } else {
        plan();
      }
    },
    report(trip) {
      // Round trips before the first route have nothing to describe.
      if (started && satisfied) {
        record(trip);
        plan();
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
): () => Promise<number> {
  return async () => {
    const controller = new AbortController();
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
    }
  };
}
