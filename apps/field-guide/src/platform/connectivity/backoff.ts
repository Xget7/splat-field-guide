/**
 * gRPC's connection backoff (https://github.com/grpc/grpc/blob/master/doc/connection-backoff.md):
 * the first retry waits the initial delay, each later one grows by the multiplier up to the cap
 * and is spread by the jitter, so clients that lost the same server do not retry in step.
 */
export const GrpcBackoff = { MULTIPLIER: 1.6, JITTER: 0.2 } as const;
export interface BackoffLimits {
  readonly initialMs: number;
  readonly maxMs: number;
}
export interface Backoff {
  /** The wait before the next retry. */
  next(): number;
  /** Starts again from the initial delay, once the remote answers. */
  reset(): void;
}
export function createBackoff(
  limits: BackoffLimits,
  random: () => number = Math.random,
): Backoff {
  let current: number | null = null;
  return {
    next() {
      if (current === null) {
        current = limits.initialMs;
        return current;
      }
      current = Math.min(current * GrpcBackoff.MULTIPLIER, limits.maxMs);
      return current * (1 + GrpcBackoff.JITTER * (random() * 2 - 1));
    },
    reset() {
      current = null;
    },
  };
}
