import type { HybridObject } from 'react-native-nitro-modules';

export interface SplatDiagnosticsSnapshot {
  liveViews: number;
  liveMetalLayers: number;
  liveRenderThreads: number;
  renderThreadsStarted: number;
  renderThreadsStopped: number;
  framesDrawn: number;
  orbitCallsOnMainThread: number;
  orbitCallsOffMainThread: number;
  /** Name of the thread that made the last `orbit` call. */
  lastOrbitThread: string;
}

/** Live-instance counters that let the app prove views do not leak. */
export interface SplatDiagnostics extends HybridObject<{ ios: 'swift' }> {
  snapshot(): SplatDiagnosticsSnapshot;
}
