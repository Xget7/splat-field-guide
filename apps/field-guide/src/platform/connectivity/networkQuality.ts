import { NetworkQuality, Transport, type NetworkStatus } from './networkStatus';

export const QualityRule = {
  WINDOW: 5,
  WEAK_RTT_MS: 800,
  GOOD_RTT_MS: 400,
  WEAK_FAILURES: 2,
  OFFLINE_FAILURES_IN_ROW: 3,
  // Successful probes in a row that end an outage.
  RECOVERY_PROBES: 2,
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
  /** Whether the latest round trip failed. */
  failing(): boolean;
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
  confirming: 'confirming recovery',
  recovered: 'probes recovered',
} as const;
/** Successful round trips since the latest failure. */
function successStreak(trips: readonly RoundTrip[]) {
  const failure = [...trips].reverse().findIndex(trip => !trip.ok);
  return failure === -1 ? trips.length : failure;
}

function medianLatency(trips: readonly RoundTrip[]): number | null {
  const times = trips
    .flatMap(trip => (trip.ok ? [trip.ms] : []))
    .sort((a, b) => a - b);
  if (times.length === 0) {
    return null;
  }
  const middle = Math.floor(times.length / 2);
  if (times.length % 2 === 0) {
    return (times[middle - 1] + times[middle]) / 2;
  }
  return times[middle];
}

type QualityDecision = Pick<NetworkStatus, 'quality' | 'reason'>;

function classifyQuality(
  path: PathInfo,
  trips: readonly RoundTrip[],
  previous: NetworkQuality,
): QualityDecision {
  const outage =
    trips.length >= QualityRule.OFFLINE_FAILURES_IN_ROW &&
    trips.slice(-QualityRule.OFFLINE_FAILURES_IN_ROW).every(trip => !trip.ok);
  const recovering = previous === NetworkQuality.offline && trips.length > 0;
  const median = medianLatency(trips);
  const failures = trips.filter(trip => !trip.ok).length;
  const bandwidthKnown = path.downstreamKbps >= 0;
  const signalKnown = path.signalLevel >= 0;
  const bandwidthRecovering =
    bandwidthKnown && path.downstreamKbps <= QualityRule.GOOD_KBPS;
  const signalRecovering =
    signalKnown &&
    path.signalLevel <=
      QualityRule.WEAK_SIGNAL_LEVEL + QualityRule.SIGNAL_RECOVERY_MARGIN;

  // The first matching rule wins; outages and degradation take priority over recovery.
  const rules: { when: boolean; then: QualityDecision }[] = [
    {
      when: !path.satisfied,
      then: { quality: NetworkQuality.offline, reason: Reason.route },
    },
    {
      when: outage,
      then: { quality: NetworkQuality.offline, reason: Reason.offline },
    },
    {
      when: recovering && successStreak(trips) < QualityRule.RECOVERY_PROBES,
      then: { quality: NetworkQuality.offline, reason: Reason.confirming },
    },
    {
      when: median !== null && median > QualityRule.WEAK_RTT_MS,
      then: { quality: NetworkQuality.weak, reason: Reason.latency },
    },
    {
      when: failures >= QualityRule.WEAK_FAILURES,
      then: { quality: NetworkQuality.weak, reason: Reason.failures },
    },
    {
      when: bandwidthKnown && path.downstreamKbps < QualityRule.WEAK_KBPS,
      then: { quality: NetworkQuality.weak, reason: Reason.bandwidth },
    },
    {
      when: signalKnown && path.signalLevel <= QualityRule.WEAK_SIGNAL_LEVEL,
      then: { quality: NetworkQuality.weak, reason: Reason.signal },
    },
    {
      when:
        previous === NetworkQuality.weak &&
        (bandwidthRecovering || signalRecovering),
      then: { quality: NetworkQuality.weak, reason: Reason.held },
    },
    {
      when: trips.length === 0,
      then: { quality: NetworkQuality.good, reason: Reason.initial },
    },
    {
      when:
        median !== null && median < QualityRule.GOOD_RTT_MS && failures === 0,
      then: { quality: NetworkQuality.good, reason: Reason.good },
    },
    {
      // A recovered route in the middle latency band can carry the online voice.
      when: recovering,
      then: { quality: NetworkQuality.good, reason: Reason.recovered },
    },
  ];
  return (
    rules.find(rule => rule.when)?.then ?? {
      quality: previous,
      reason: Reason.held,
    }
  );
}

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
  function updateStatus(): NetworkStatus {
    const streak = successStreak(trips);
    if (!path.satisfied) {
      trips = [];
    } else if (
      status.quality === NetworkQuality.offline &&
      streak >= QualityRule.RECOVERY_PROBES
    ) {
      // The outage is over, and its failures no longer describe the route.
      trips = trips.slice(-streak);
    }
    status = {
      ...classifyQuality(path, trips, status.quality),
      transport: path.transport,
    };
    return status;
  }
  return {
    path(info) {
      if (info.transport !== path.transport) {
        // A new route starts a new measurement window.
        trips = [];
      }
      path = info;
      return updateStatus();
    },
    sample(trip) {
      trips = [...trips, trip].slice(-QualityRule.WINDOW);
      return updateStatus();
    },
    current: () => status,
    failing: () => trips.at(-1)?.ok === false,
  };
}
