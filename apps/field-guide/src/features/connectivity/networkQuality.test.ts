import { createQualityEstimator, type PathInfo } from './networkQuality';
import { NetworkQuality, Transport } from '../events/types';

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
  expect(quality.sample({ ok: true, ms: 100 }).quality).toBe(
    NetworkQuality.weak,
  );
  expect(quality.path({ ...route, satisfied: false }).reason).toBe('no route');
  expect(quality.path(route).quality).toBe(NetworkQuality.good);
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
