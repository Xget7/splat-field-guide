import { createBackoff, GrpcBackoff } from '../backoff';

const LIMITS = { initialMs: 1000, maxMs: 3000 };
const LOWEST = 0;
const HIGHEST = 1;

test('retries grow by the gRPC multiplier up to the cap and start over after a reset', () => {
  const backoff = createBackoff(LIMITS, () => 0.5);
  expect([
    backoff.next(),
    backoff.next(),
    backoff.next(),
    backoff.next(),
  ]).toEqual([
    1000,
    1000 * GrpcBackoff.MULTIPLIER,
    1000 * GrpcBackoff.MULTIPLIER * GrpcBackoff.MULTIPLIER,
    3000,
  ]);
  backoff.reset();
  expect(backoff.next()).toBe(1000);
});

test('jitter spreads each later retry by a fifth either way', () => {
  const low = createBackoff(LIMITS, () => LOWEST);
  const high = createBackoff(LIMITS, () => HIGHEST);
  low.next();
  high.next();
  const grown = 1000 * GrpcBackoff.MULTIPLIER;
  expect(low.next()).toBeCloseTo(grown * (1 - GrpcBackoff.JITTER));
  expect(high.next()).toBeCloseTo(grown * (1 + GrpcBackoff.JITTER));
});
