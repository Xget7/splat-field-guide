import type { SplatDiagnosticsSnapshot } from 'react-native-splat';
import { runMountStress } from '../src/mountStress';

const CYCLES = 5;

function makeDeps(leakEveryView: boolean) {
  const live = { views: 0, threads: 0, started: 0, stopped: 0 };
  let mounted = false;
  const snapshot = (): SplatDiagnosticsSnapshot => ({
    liveViews: live.views,
    liveMetalLayers: live.views,
    liveRenderThreads: live.threads,
    renderThreadsStarted: live.started,
    renderThreadsStopped: live.stopped,
    framesPresented: 0,
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
        if (!leakEveryView) {
          live.views -= 1;
        }
      }
      mounted = next;
    },
    snapshot,
    sleep: () => Promise.resolve(),
    collectGarbage: () => {},
  };
}

test('passes when every view and thread is released', async () => {
  const report = await runMountStress(makeDeps(false), CYCLES);
  expect(report.passed).toBe(true);
  expect(report.threadsStarted).toBe(CYCLES);
  expect(report.peakLiveRenderThreads).toBe(1);
});

test('fails when views outlive their unmount', async () => {
  const report = await runMountStress(makeDeps(true), CYCLES);
  expect(report.passed).toBe(false);
  expect(report.final.liveViews).toBe(CYCLES);
});
