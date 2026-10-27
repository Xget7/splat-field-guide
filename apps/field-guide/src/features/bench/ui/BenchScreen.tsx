import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { callback } from 'react-native-nitro-modules';
import { SplatView, type SplatViewSpec } from 'react-native-splat';
import { useCatalog } from '../../../app/context/CatalogContext';
import { GuideStatus, type ReadyGuide } from '../../pack/catalog';
import type { Pack } from '../../pack/pack';
import { sourceFor } from '../../pack/bundledPack';
import { INITIAL_SESSION } from '../../guide';
import { cameraLimitsInRadians, NO_SIZE } from '../../viewer';
import { useGuideFraming } from '../../viewer/views';

import { Color } from '../../../ui/theme';

const NO_FRAME_REQUEST = 0;
const NO_HIGHLIGHT: number[] = [];
const MAX_SWEEP_DEGREES = 40;
// Stopping short of the azimuth limits keeps the sweep moving, since orbit stops at a limit.
const LIMIT_MARGIN_DEGREES = 5;
const SWEEP_PERIOD_MS = 20_000;
const RADIANS_PER_DEGREE = Math.PI / 180;

/** The first ready pack framed whole with no UI over it: the widest view, the heaviest frame. */
export function BenchScreen() {
  const guide = useCatalog().find(
    (entry): entry is ReadyGuide => entry.status === GuideStatus.ready,
  );
  return (
    <View testID="bench-screen" style={styles.screen}>
      {guide && <BenchView pack={guide.pack} />}
    </View>
  );
}

/**
 * The renderer stops drawing once the camera holds still, so the bench sweeps the camera
 * continuously to keep every frame a full draw of the wide view.
 */
function BenchView({ pack }: { pack: Pack }) {
  const [view, setView] = useState<SplatViewSpec | null>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState(NO_SIZE);
  const source = useMemo(() => sourceFor(pack), [pack]);
  const limits = useMemo(
    () => cameraLimitsInRadians(pack.camera.limits),
    [pack],
  );
  const sweep = useMemo(() => sweepRadians(pack), [pack]);
  const activeView = ready ? view : null;
  useGuideFraming(activeView, INITIAL_SESSION, pack, NO_FRAME_REQUEST, size);

  useEffect(() => {
    if (activeView === null || size.width === 0) {
      return;
    }
    let frame = 0;
    let start: number | null = null;
    let offset = 0;
    const step = (now: number) => {
      start ??= now;
      const next =
        sweep * Math.sin(((now - start) / SWEEP_PERIOD_MS) * 2 * Math.PI);
      activeView.orbit(next - offset, 0);
      offset = next;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [activeView, size.width, sweep]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize(current =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);
  const onView = useCallback((native: SplatViewSpec) => setView(native), []);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setReady(false), []);

  return (
    <View style={styles.screen} onLayout={onLayout}>
      <SplatView
        style={styles.screen}
        source={source}
        highlight={NO_HIGHLIGHT}
        cameraLimits={limits}
        onReady={callback(onReady)}
        onError={callback(onError)}
        hybridRef={callback(onView)}
      />
    </View>
  );
}

function sweepRadians(pack: Pack): number {
  const { home, limits } = pack.camera;
  const room = Math.min(
    home.azimuth - limits.minAzimuth,
    limits.maxAzimuth - home.azimuth,
  );
  return (
    Math.max(0, Math.min(MAX_SWEEP_DEGREES, room - LIMIT_MARGIN_DEGREES)) *
    RADIANS_PER_DEGREE
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Color.surface },
});
