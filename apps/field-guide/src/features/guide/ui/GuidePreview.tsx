import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { callback } from 'react-native-nitro-modules';
import { SplatView, type SplatViewSpec } from 'react-native-splat';
import { sourceFor } from '../../pack/bundledPack';
import type { Pack, PartId } from '../../pack/pack';
import { directionFor, framingFor, highlightFor } from '../domain/derive';
import {
  CourseButton,
  CourseIconButton,
  CourseIconSurface,
} from './CourseControls';
import { IconName } from '../../../ui/Icon';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
} from '../../../ui/courseTokens';

const RADIANS = Math.PI / 180;
const ORBIT_STEP = Math.PI / 8;
const PREVIEW_CONTEXT = 1.1;
// A single machine needs more room around it than the whole cell to read as part of the cell.
const FOCUS_CONTEXT = 1.6;
const FOCUS_SECONDS = 0.4;
const RECENTER_SECONDS = 0.3;

interface PreviewProps {
  readonly pack: Pack;
  /** A machine to frame and highlight; null shows the whole cell. */
  readonly focus?: PartId | null;
}

/** The same verified reconstruction used by the activity, with a separate native lifetime. */
export function GuidePreview({ pack, focus = null }: PreviewProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PreviewModel
      key={`${pack.packId}:${pack.packVersion}:${attempt}`}
      pack={pack}
      focus={focus}
      onRetry={() => setAttempt(value => value + 1)}
    />
  );
}

function PreviewModel({
  pack,
  focus,
  onRetry,
}: Required<PreviewProps> & { onRetry: () => void }) {
  const [view, setView] = useState<SplatViewSpec | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const source = useMemo(() => sourceFor(pack), [pack]);
  const limits = useMemo(
    () => ({
      ...pack.camera.limits,
      minAzimuth: pack.camera.limits.minAzimuth * RADIANS,
      maxAzimuth: pack.camera.limits.maxAzimuth * RADIANS,
      minElevation: pack.camera.limits.minElevation * RADIANS,
      maxElevation: pack.camera.limits.maxElevation * RADIANS,
    }),
    [pack],
  );
  // The guide's own selection rules decide what a focused machine frames and highlights.
  const subject = useMemo(
    () => ({ procedureId: null, stepIndex: 0, selectedPart: focus }),
    [focus],
  );
  const highlight = useMemo(
    () => [...highlightFor(subject, pack)],
    [subject, pack],
  );
  const target = useMemo(() => {
    const framing = framingFor(subject, pack);
    if (framing === null) return null;
    const context = focus === null ? PREVIEW_CONTEXT : FOCUS_CONTEXT;
    const point = (edge: readonly number[]) => {
      const coordinates = edge.map((value, axis) => {
        const centre = (framing.min[axis] + framing.max[axis]) / 2;
        return centre + (value - centre) * context;
      });
      return { x: coordinates[0], y: coordinates[1], z: coordinates[2] };
    };
    const direction = directionFor(subject, pack);
    return {
      bounds: { min: point(framing.min), max: point(framing.max) },
      from: {
        azimuth: direction.azimuth * RADIANS,
        elevation: direction.elevation * RADIANS,
      },
    };
  }, [subject, pack, focus]);

  // The first framing is instant; later focus changes move the camera so the change reads.
  const framed = useRef(false);
  useEffect(() => {
    if (ready && view && target && size.width > 0 && size.height > 0) {
      view.frame(
        target.bounds,
        framed.current ? FOCUS_SECONDS : 0,
        target.from,
      );
      framed.current = true;
    }
  }, [ready, view, target, size]);

  return (
    <View
      testID="guide-preview"
      style={styles.root}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setSize(current =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
      }}
    >
      <SplatView
        testID="guide-preview-model"
        style={styles.root}
        source={source}
        highlight={highlight}
        cameraLimits={limits}
        hybridRef={callback(native => setView(native))}
        onReady={callback(() => setReady(true))}
        onError={callback(failure => {
          setReady(false);
          setError(failure.message);
        })}
      />
      {!ready && error === '' && (
        <View style={styles.status}>
          <ActivityIndicator color={C.accent} />
          <Text accessibilityRole="status" style={styles.statusText}>
            Loading 3D preview
          </Text>
        </View>
      )}
      {error !== '' && (
        <View style={styles.status}>
          <Text accessibilityRole="alert" style={styles.statusText}>
            {error}
          </Text>
          <CourseButton label="Retry preview" onPress={onRetry} />
        </View>
      )}
      {ready && error === '' && (
        <View style={styles.controls}>
          <CourseIconButton
            surface={CourseIconSurface.overlay}
            icon={IconName.back}
            accessibilityLabel="Rotate preview left"
            onPress={() => view?.orbit(-ORBIT_STEP, 0)}
          />
          <CourseIconButton
            surface={CourseIconSurface.overlay}
            icon={IconName.frame}
            accessibilityLabel="Recenter preview"
            onPress={() =>
              target &&
              view?.frame(target.bounds, RECENTER_SECONDS, target.from)
            }
          />
          <CourseIconButton
            surface={CourseIconSurface.overlay}
            icon={IconName.next}
            accessibilityLabel="Rotate preview right"
            onPress={() => view?.orbit(ORBIT_STEP, 0)}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  status: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: G.small,
    padding: G.medium,
    backgroundColor: C.surface,
  },
  statusText: { ...T.body, color: C.secondary, textAlign: 'center' },
  // Separate squares over the model, matching the back button, rather than one rounded tray.
  controls: {
    position: 'absolute',
    bottom: G.small,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: G.unit,
  },
});
