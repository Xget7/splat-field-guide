import type { SplatDiagnosticsSnapshot } from 'react-native-splat';

export const MountStress = {
  cycles: 100,
  /** Time the view stays mounted, and unmounted, in each cycle. */
  phaseMs: 40,
  /** Time for the last render thread to exit after the final unmount. */
  settleMs: 500,
  /** Hermes frees a native view only when its JS wrapper is collected. */
  collectPasses: 3,
} as const;

export interface MountStressDeps {
  setMounted: (mounted: boolean) => void;
  snapshot: () => SplatDiagnosticsSnapshot;
  sleep: (ms: number) => Promise<void>;
  /** Forces a JS garbage collection where the engine allows it. */
  collectGarbage: () => void;
}

export interface MountStressReport {
  cycles: number;
  passed: boolean;
  peakLiveViews: number;
  peakLiveMetalLayers: number;
  peakLiveRenderThreads: number;
  threadsStarted: number;
  threadsStopped: number;
  final: SplatDiagnosticsSnapshot;
}

/** Mounts and unmounts the view back to back, then checks that nothing stayed alive. */
export async function runMountStress(
  deps: MountStressDeps,
  cycles: number = MountStress.cycles,
): Promise<MountStressReport> {
  // Views go only once JS collects their wrappers, so both counts are taken after that.
  const settle = async () => {
    await deps.sleep(MountStress.settleMs);
    for (let i = 0; i < MountStress.collectPasses; i++) {
      deps.collectGarbage();
      await deps.sleep(MountStress.phaseMs);
    }
  };
  deps.setMounted(false);
  await settle();
  const before = deps.snapshot();
  let peakLiveViews = 0;
  let peakLiveMetalLayers = 0;
  let peakLiveRenderThreads = 0;
  const samplePeaks = () => {
    const now = deps.snapshot();
    peakLiveViews = Math.max(peakLiveViews, now.liveViews);
    peakLiveMetalLayers = Math.max(peakLiveMetalLayers, now.liveMetalLayers);
    peakLiveRenderThreads = Math.max(
      peakLiveRenderThreads,
      now.liveRenderThreads,
    );
  };

  for (let i = 0; i < cycles; i++) {
    deps.setMounted(true);
    await deps.sleep(MountStress.phaseMs);
    samplePeaks();
    deps.setMounted(false);
    await deps.sleep(MountStress.phaseMs);
    samplePeaks();
  }
  await settle();
  const final = deps.snapshot();
  const threadsStarted =
    final.renderThreadsStarted - before.renderThreadsStarted;
  const threadsStopped =
    final.renderThreadsStopped - before.renderThreadsStopped;
  const passed =
    final.liveViews === before.liveViews &&
    final.liveMetalLayers === before.liveMetalLayers &&
    final.liveRenderThreads === before.liveRenderThreads &&
    threadsStarted === cycles &&
    threadsStopped === cycles;
  return {
    cycles,
    passed,
    peakLiveViews,
    peakLiveMetalLayers,
    peakLiveRenderThreads,
    threadsStarted,
    threadsStopped,
    final,
  };
}
