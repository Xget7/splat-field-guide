import type { SplatDiagnosticsSnapshot } from 'react-native-splat';
import { runMountStress } from '../src/mountStress';

const CYCLES = 5;

const Release = {
  /** An unmounted view goes at once. */
  onUnmount: 'onUnmount',
  /** An unmounted view waits for JS to collect its wrapper, as on Hermes. */
  onCollect: 'onCollect',
  /** An unmounted view never goes. */
  never: 'never',
} as const;
type Release = (typeof Release)[keyof typeof Release];

/** A screen that starts with its view mounted, like the spike screen. */
function makeDeps(release: Release) {
  const live = { views: 1, threads: 1, started: 1, stopped: 0 };
  let garbage = 0;
  let mounted = true;
  const snapshot = (): SplatDiagnosticsSnapshot => ({
    liveViews: live.views,
    liveMetalLayers: live.views,
    liveRenderThreads: live.threads,
    renderThreadsStarted: live.started,
    renderThreadsStopped: live.stopped,
    framesDrawn: 0,
    orbitCallsOnMainThread: 0,
    orbitCallsOffMainThread: 0,
    lastOrbitThread: '',
  });
  return {
    setMounted: (next: boolean) => {
      if (next && !mounted) {
        live.views += 1;
        live.threads += 1;
        live.started += 1;
      } else if (!next && mounted) {
        live.threads -= 1;
        live.stopped += 1;
        if (release === Release.onUnmount) {
          live.views -= 1;
        } else if (release === Release.onCollect) {
          garbage += 1;
        }
      }
      mounted = next;
    },
    snapshot,
    sleep: () => Promise.resolve(),
    collectGarbage: () => {
      live.views -= garbage;
      garbage = 0;
    },
  };
}

test('passes when every view and thread is released', async () => {
  const report = await runMountStress(makeDeps(Release.onUnmount), CYCLES);
  expect(report.passed).toBe(true);
  expect(report.threadsStarted).toBe(CYCLES);
  expect(report.peakLiveRenderThreads).toBe(1);
});

test('passes when views wait for JS to collect them', async () => {
  const report = await runMountStress(makeDeps(Release.onCollect), CYCLES);
  expect(report.passed).toBe(true);
  expect(report.final.liveViews).toBe(0);
});

test('fails when views outlive their unmount', async () => {
  const report = await runMountStress(makeDeps(Release.never), CYCLES);
  expect(report.passed).toBe(false);
  expect(report.final.liveViews).toBe(CYCLES + 1);
});
