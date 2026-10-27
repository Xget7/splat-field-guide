import {
  createQualityEstimator,
  type PathInfo,
} from '../apps/field-guide/src/features/connectivity/networkQuality';
import {
  NetworkQuality,
  Transport,
} from '../apps/field-guide/src/features/events/types';

const route: PathInfo = {
  satisfied: true,
  transport: Transport.wifi,
  downstreamKbps: -1,
  signalLevel: -1,
};
test('path loss clears measurements and three failed probes are offline', () => {
  const quality = createQualityEstimator();
  quality.path(route);
  for (let i = 0; i < 3; i++) {
    quality.sample({ ok: false });
  }
  expect(quality.current().quality).toBe(NetworkQuality.offline);
  expect(quality.path({ ...route, satisfied: false }).reason).toBe('no route');
  expect(quality.path(route).quality).toBe(NetworkQuality.good);
});
test('an outage ends after two answered probes, and a slower route counts as good', () => {
  const quality = createQualityEstimator();
  quality.path(route);
  for (let i = 0; i < 3; i++) {
    quality.sample({ ok: false });
  }
  expect(quality.sample({ ok: true, ms: 600 }).quality).toBe(
    NetworkQuality.offline,
  );
  expect(quality.sample({ ok: true, ms: 600 }).quality).toBe(
    NetworkQuality.good,
  );
  quality.sample({ ok: false });
  quality.sample({ ok: false });
  expect(quality.current().quality).toBe(NetworkQuality.weak);
  expect(
    quality.path({ ...route, transport: Transport.cellular }).quality,
  ).toBe(NetworkQuality.good);
});
test('latency, failures, bandwidth and signal identify a weak connection', () => {
  const quality = createQualityEstimator();
  quality.path(route);
  expect(quality.sample({ ok: true, ms: 801 }).quality).toBe(
    NetworkQuality.weak,
  );
  quality.path({ ...route, satisfied: false });
  quality.path(route);
  for (const ok of [true, false, true, false, true]) {
    quality.sample(ok ? { ok, ms: 100 } : { ok });
  }
  expect(quality.current().quality).toBe(NetworkQuality.weak);
  expect(quality.path({ ...route, downstreamKbps: 500 }).quality).toBe(
    NetworkQuality.weak,
  );
  expect(quality.path({ ...route, signalLevel: 1 }).quality).toBe(
    NetworkQuality.weak,
  );
});
test('the middle latency band preserves good or weak quality', () => {
  for (const initialMs of [100, 900]) {
    const quality = createQualityEstimator();
    quality.path(route);
    const previous = quality.sample({ ok: true, ms: initialMs }).quality;
    for (let i = 0; i < 5; i++) {
      quality.sample({ ok: true, ms: 600 });
    }
    expect(quality.current().quality).toBe(previous);
  }
});

test('bandwidth around the weak boundary cannot make the connection flap', () => {
  const quality = createQualityEstimator();
  quality.path(route);
  for (const downstreamKbps of [900, 1100, 950, 1500, 2000]) {
    expect(quality.path({ ...route, downstreamKbps }).quality).toBe(
      NetworkQuality.weak,
    );
  }
  expect(quality.path({ ...route, downstreamKbps: 2100 }).quality).toBe(
    NetworkQuality.good,
  );
});

test('a weak signal must recover past the middle level before returning to good', () => {
  const quality = createQualityEstimator();
  expect(quality.path({ ...route, signalLevel: 1 }).quality).toBe(
    NetworkQuality.weak,
  );
  expect(quality.path({ ...route, signalLevel: 2 }).quality).toBe(
    NetworkQuality.weak,
  );
  expect(quality.path({ ...route, signalLevel: 3 }).quality).toBe(
    NetworkQuality.good,
  );
});

test.each([
  { latencies: [100, 900], quality: NetworkQuality.good },
  { latencies: [900, 100], quality: NetworkQuality.weak },
  { latencies: [900, 100, 100], quality: NetworkQuality.good },
  { latencies: [100, 900, 900], quality: NetworkQuality.weak },
  { latencies: [900, 400, 400], quality: NetworkQuality.weak },
  { latencies: [900, 399, 399], quality: NetworkQuality.good },
  { latencies: [800], quality: NetworkQuality.good },
])('classifies median latency with hysteresis: $latencies', scenario => {
  const estimator = createQualityEstimator();
  estimator.path(route);
  for (const ms of scenario.latencies) {
    estimator.sample({ ok: true, ms });
  }
  expect(estimator.current().quality).toBe(scenario.quality);
});

test('only failures in the current probe window affect quality', () => {
  const estimator = createQualityEstimator();
  estimator.path(route);
  estimator.sample({ ok: false });
  estimator.sample({ ok: false });
  for (let i = 0; i < 4; i++) {
    estimator.sample({ ok: true, ms: 100 });
  }
  expect(estimator.current().quality).toBe(NetworkQuality.weak);
  expect(estimator.sample({ ok: true, ms: 100 }).quality).toBe(
    NetworkQuality.good,
  );
  expect(estimator.failing()).toBe(false);
});

test('a failed probe restarts outage recovery and confirmed recovery discards old failures', () => {
  const estimator = createQualityEstimator();
  estimator.path(route);
  for (let i = 0; i < 3; i++) {
    estimator.sample({ ok: false });
  }
  estimator.sample({ ok: true, ms: 600 });
  expect(estimator.sample({ ok: false })).toEqual({
    quality: NetworkQuality.offline,
    transport: Transport.wifi,
    reason: 'confirming recovery',
  });
  expect(estimator.failing()).toBe(true);
  expect(estimator.sample({ ok: true, ms: 600 }).quality).toBe(
    NetworkQuality.offline,
  );
  expect(estimator.sample({ ok: true, ms: 600 })).toEqual({
    quality: NetworkQuality.good,
    transport: Transport.wifi,
    reason: 'probes recovered',
  });
  expect(estimator.sample({ ok: true, ms: 600 }).quality).toBe(
    NetworkQuality.good,
  );
});

test.each([
  { path: route, ms: 900, reason: 'slow round trips' },
  {
    path: { ...route, downstreamKbps: 500 },
    ms: 100,
    reason: 'low bandwidth',
  },
  { path: { ...route, signalLevel: 1 }, ms: 100, reason: 'low signal' },
])('confirmed recovery still respects $reason', scenario => {
  const estimator = createQualityEstimator();
  estimator.path(scenario.path);
  for (let i = 0; i < 3; i++) {
    estimator.sample({ ok: false });
  }
  estimator.sample({ ok: true, ms: scenario.ms });
  expect(estimator.sample({ ok: true, ms: scenario.ms })).toEqual({
    quality: NetworkQuality.weak,
    transport: Transport.wifi,
    reason: scenario.reason,
  });
});
