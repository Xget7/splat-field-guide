import type { HybridObject } from 'react-native-nitro-modules';

export type NetworkTransport = 'wifi' | 'cellular' | 'wired' | 'other' | 'none';

export interface NetworkPath {
  /** The system has a usable route; on Android the network is also validated. */
  satisfied: boolean;
  transport: NetworkTransport;
  expensive: boolean;
  constrained: boolean;
  /** Estimated downstream bandwidth, or -1 when unknown (always on iOS). */
  downstreamKbps: number;
  /** Signal level from 0 to 4, or -1 when unknown (always on iOS). */
  signalLevel: number;
}

/** Reports the network path at once and on every change. */
export interface NetworkMonitor
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** Replaces any previous listener; onChange runs first with the current path. */
  start(onChange: (path: NetworkPath) => void): void;
  /** Safe when not started. */
  stop(): void;
}
