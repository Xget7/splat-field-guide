import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { callback } from 'react-native-nitro-modules';
import {
  SplatDiagnostics,
  SplatView,
  type SplatDiagnosticsSnapshot,
  type SplatViewSpec,
} from 'react-native-splat';
import {
  MountStress,
  runMountStress,
  type MountStressReport,
} from './mountStress';

/** Radians of azimuth per pixel of pan. */
const RADIANS_PER_PIXEL = 0.01;
const DIAGNOSTICS_REFRESH_MS = 500;
const HIGHLIGHT_ON = [1];
const HIGHLIGHT_OFF: number[] = [];

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

export function SplatSpikeScreen() {
  const [mounted, setMounted] = useState(true);
  const [view, setView] = useState<SplatViewSpec | null>(null);
  const [readyCount, setReadyCount] = useState(0);
  const [highlighted, setHighlighted] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<MountStressReport | null>(null);
  const [diagnostics, setDiagnostics] = useState<SplatDiagnosticsSnapshot>(() =>
    SplatDiagnostics.snapshot(),
  );

  useEffect(() => {
    const id = setInterval(
      () => setDiagnostics(SplatDiagnostics.snapshot()),
      DIAGNOSTICS_REFRESH_MS,
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!mounted) {
      setView(null);
    }
  }, [mounted]);

  // The callbacks below run on the UI thread; `view` is a Nitro hybrid object
  // that Worklets serialises, so `orbit` is called without touching JS.
  const pan = usePanGesture({
    onUpdate: event => {
      'worklet';
      view?.orbit(
        -event.changeX * RADIANS_PER_PIXEL,
        event.changeY * RADIANS_PER_PIXEL,
      );
    },
  });

  const onReady = useCallback(() => setReadyCount(count => count + 1), []);
  const onHybridRef = useCallback(
    (ref: SplatViewSpec) => setView(ref),
    [],
  );

  const startStress = useCallback(async () => {
    setRunning(true);
    setReport(null);
    const result = await runMountStress({
      setMounted,
      snapshot: () => SplatDiagnostics.snapshot(),
      sleep,
      collectGarbage: () => (globalThis as { gc?: () => void }).gc?.(),
    });
    setMounted(true);
    setReport(result);
    setRunning(false);
  }, []);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={pan}>
        <View style={styles.root}>
          {mounted && (
            <SplatView
              style={styles.root}
              highlight={highlighted ? HIGHLIGHT_ON : HIGHLIGHT_OFF}
              onReady={callback(onReady)}
              hybridRef={callback(onHybridRef)}
            />
          )}
        </View>
      </GestureDetector>
      <View style={styles.hud} pointerEvents="box-none">
        <Text style={styles.text} testID="ready-count">
          onReady calls: {readyCount}
        </Text>
        <Text style={styles.text}>
          live views {diagnostics.liveViews}, layers{' '}
          {diagnostics.liveMetalLayers}, threads {diagnostics.liveRenderThreads}
        </Text>
        <Text style={styles.text}>
          threads started {diagnostics.renderThreadsStarted}, stopped{' '}
          {diagnostics.renderThreadsStopped}
        </Text>
        <Text style={styles.text}>
          orbit calls: main {diagnostics.orbitCallsOnMainThread}, other{' '}
          {diagnostics.orbitCallsOffMainThread} (last{' '}
          {diagnostics.lastOrbitThread || 'none'})
        </Text>
        {report && (
          <Text style={styles.text} testID="stress-report">
            {report.passed ? 'PASS' : 'FAIL'} {report.cycles} cycles: started{' '}
            {report.threadsStarted}, stopped {report.threadsStopped}, peak
            views {report.peakLiveViews}, layers {report.peakLiveMetalLayers},
            threads {report.peakLiveRenderThreads}
          </Text>
        )}
      </View>
      <View style={styles.buttons}>
        <Pressable
          style={[styles.button, running && styles.disabled]}
          disabled={running}
          onPress={startStress}>
          <Text style={styles.text}>
            {running ? 'Running...' : `Mount x${MountStress.cycles}`}
          </Text>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() => setHighlighted(value => !value)}>
          <Text style={styles.text}>Highlight {highlighted ? 'on' : 'off'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'black' },
  hud: { position: 'absolute', top: 60, left: 16, right: 16 },
  buttons: {
    position: 'absolute',
    bottom: 48,
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  disabled: { opacity: 0.5 },
  text: { color: 'white', fontSize: 13, fontVariant: ['tabular-nums'] },
});
