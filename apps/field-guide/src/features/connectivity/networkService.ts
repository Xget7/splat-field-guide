import type { NetworkStatus } from '../events/types';
import {
  createQualityEstimator,
  type PathInfo,
  type RoundTrip,
} from './networkQuality';

export const PROBE_INTERVAL_MS = 30000;
export const PROBE_TIMEOUT_MS = 3000;
export interface PathSource {
  start(onChange: (info: PathInfo) => void): void;
  stop(): void;
}
export interface NetworkServiceOptions {
  readonly paths: PathSource;
  readonly probe: () => Promise<number>;
  readonly emit: (status: NetworkStatus) => void;
  readonly setInterval?: typeof setInterval;
  readonly clearInterval?: typeof clearInterval;
}
export interface NetworkService {
  start(): void;
  stop(): void;
  setActive(active: boolean): void;
  report(trip: RoundTrip): void;
}
export function createNetworkService(
  options: NetworkServiceOptions,
): NetworkService {
  const schedule = options.setInterval ?? setInterval;
  const cancel = options.clearInterval ?? clearInterval;
  const estimator = createQualityEstimator();
  let started = false;
  let active = false;
  let satisfied = false;
  let generation = 0;
  let probing = false;
  let probeAgain = false;
  let interval: ReturnType<typeof setInterval> | null = null;
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
  async function probe() {
    if (!started || !satisfied) {
      return;
    }
    if (probing) {
      return;
    }
    probing = true;
    const currentGeneration = generation;
    let trip: RoundTrip;
    try {
      trip = { ok: true, ms: await options.probe() };
    } catch {
      trip = { ok: false };
    }
    probing = false;
    if (started && currentGeneration === generation) {
      publish(estimator.sample(trip));
    }
    if (probeAgain) {
      probeAgain = false;
      probe();
    }
  }
  function updateInterval() {
    if (interval !== null) {
      cancel(interval);
      interval = null;
    }
    if (started && active) {
      interval = schedule(() => {
        probe();
      }, PROBE_INTERVAL_MS);
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
        satisfied = info.satisfied;
        publish(estimator.path(info));
        if (satisfied) {
          if (probing) {
            probeAgain = true;
          } else {
            probe();
          }
        }
      });
      updateInterval();
    },
    stop() {
      if (!started) {
        return;
      }
      started = false;
      generation++;
      probeAgain = false;
      options.paths.stop();
      updateInterval();
    },
    setActive(value) {
      active = value;
      updateInterval();
    },
    report(trip) {
      if (started) {
        publish(estimator.sample(trip));
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
