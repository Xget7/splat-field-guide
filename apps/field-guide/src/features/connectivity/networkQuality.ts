import { NetworkQuality, Transport, type NetworkStatus } from '../events/types';

export const QualityRule = {
  WINDOW: 5,
  WEAK_RTT_MS: 800,
  GOOD_RTT_MS: 400,
  WEAK_FAILURES: 2,
  OFFLINE_FAILURES_IN_ROW: 3,
  WEAK_KBPS: 1000,
  GOOD_KBPS: 2000,
  WEAK_SIGNAL_LEVEL: 1,
  SIGNAL_RECOVERY_MARGIN: 1,
} as const;
export interface PathInfo {
  readonly satisfied: boolean;
  readonly transport: Transport;
  readonly downstreamKbps: number;
  readonly signalLevel: number;
}
export type RoundTrip =
  | { readonly ok: true; readonly ms: number }
  | { readonly ok: false };
export interface QualityEstimator {
  path(info: PathInfo): NetworkStatus;
  sample(trip: RoundTrip): NetworkStatus;
  current(): NetworkStatus;
}
const Reason = {
  unknown: 'unknown',
  route: 'no route',
  offline: 'probes failed',
  latency: 'slow round trips',
  failures: 'failed probes',
  bandwidth: 'low bandwidth',
  signal: 'low signal',
  good: 'fast round trips',
  initial: 'route available',
  held: 'latency hysteresis',
} as const;
const MEDIAN_DIVISOR = 2;
export function createQualityEstimator(): QualityEstimator {
  let path: PathInfo = {
    satisfied: true,
    transport: Transport.other,
    downstreamKbps: -1,
    signalLevel: -1,
  };
  let trips: RoundTrip[] = [];
  let status: NetworkStatus = {
    quality: NetworkQuality.good,
    transport: path.transport,
    reason: Reason.unknown,
  };
  function estimate(): NetworkStatus {
    const successful = trips
      .flatMap(trip => (trip.ok ? [trip.ms] : []))
      .sort((a, b) => a - b);
    const middle = Math.floor(successful.length / MEDIAN_DIVISOR);
    const median =
      successful.length === 0
        ? null
        : successful.length % MEDIAN_DIVISOR === 0
        ? (successful[middle - 1] + successful[middle]) / MEDIAN_DIVISOR
        : successful[middle];
    const failures = trips.filter(trip => !trip.ok).length;
    let quality = status.quality;
    let reason: string = Reason.held;
    if (!path.satisfied) {
      trips = [];
      quality = NetworkQuality.offline;
      reason = Reason.route;
    } else if (
      trips.length >= QualityRule.OFFLINE_FAILURES_IN_ROW &&
      trips.slice(-QualityRule.OFFLINE_FAILURES_IN_ROW).every(trip => !trip.ok)
    ) {
      quality = NetworkQuality.offline;
      reason = Reason.offline;
    } else if (median !== null && median > QualityRule.WEAK_RTT_MS) {
      quality = NetworkQuality.weak;
      reason = Reason.latency;
    } else if (failures >= QualityRule.WEAK_FAILURES) {
      quality = NetworkQuality.weak;
      reason = Reason.failures;
    } else if (
      path.downstreamKbps >= 0 &&
      path.downstreamKbps < QualityRule.WEAK_KBPS
    ) {
      quality = NetworkQuality.weak;
      reason = Reason.bandwidth;
    } else if (
      path.signalLevel >= 0 &&
      path.signalLevel <= QualityRule.WEAK_SIGNAL_LEVEL
    ) {
      quality = NetworkQuality.weak;
      reason = Reason.signal;
    } else if (
      status.quality === NetworkQuality.weak &&
      ((path.downstreamKbps >= 0 &&
        path.downstreamKbps <= QualityRule.GOOD_KBPS) ||
        (path.signalLevel >= 0 &&
          path.signalLevel <=
            QualityRule.WEAK_SIGNAL_LEVEL + QualityRule.SIGNAL_RECOVERY_MARGIN))
    ) {
      quality = NetworkQuality.weak;
    } else if (
      trips.length === 0 ||
      (median !== null && median < QualityRule.GOOD_RTT_MS && failures === 0)
    ) {
      quality = NetworkQuality.good;
      reason = trips.length === 0 ? Reason.initial : Reason.good;
    } else if (quality === NetworkQuality.offline) {
      quality = NetworkQuality.weak;
    }
    status = { quality, transport: path.transport, reason };
    return status;
  }
  return {
    path(info) {
      path = info;
      return estimate();
    },
    sample(trip) {
      trips = [...trips, trip].slice(-QualityRule.WINDOW);
      return estimate();
    },
    current: () => status,
  };
}
