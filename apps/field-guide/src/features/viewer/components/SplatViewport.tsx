import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { callback } from 'react-native-nitro-modules';
import {
  SplatView,
  type SplatError,
  type SplatViewSpec,
} from 'react-native-splat';
import { scheduleOnRN } from 'react-native-worklets';
import { packFacts } from '../../../modules/catalog/catalog';
import type { Pack } from '../../../domain/pack';
import { sourceFor } from '../../../modules/packs/bundledPack';
import { Icon, IconName } from '../../../shared/ui/kit/Icon';
import { Label } from '../../../shared/ui/kit/Label';
import {
  Color,
  HAIRLINE,
  Motion,
  Radius,
  Space,
  Type,
} from '../../../shared/ui/theme';
import { cameraLimitsInRadians } from '../model/camera';
import type { Size } from './PartMarkers';

export const RADIANS_PER_POINT = 0.01;
const PAN_ACTIVATION_POINTS = 8;
const TAP_MAX_DISTANCE_POINTS = 8;
const ERROR_ICON = 16;
const MS_PER_SECOND = 1000;

interface Props {
  pack: Pack;
  highlight: number[];
  view: SplatViewSpec | null;
  /** The viewport's size, measured by the screen around it. */
  size: Size;
  /** Says what is on screen for VoiceOver. */
  accessibilityLabel: string;
  loading: boolean;
  /** A loaded capture sweeps in rather than appearing at once. */
  materialize: boolean;
  error: string;
  onView: (view: SplatViewSpec) => void;
  onReady: () => void;
  onError: (error: SplatError) => void;
  onPick: (x: number, y: number) => void;
}

export function SplatViewport({
  pack,
  highlight,
  view,
  size,
  accessibilityLabel,
  loading,
  materialize,
  error,
  onView,
  onReady,
  onError,
  onPick,
}: Props) {
  const source = useMemo(() => sourceFor(pack), [pack]);
  const limits = useMemo(
    () => cameraLimitsInRadians(pack.camera.limits),
    [pack],
  );
  const pick = useCallback(
    (x: number, y: number) => {
      if (size.width > 0 && size.height > 0) {
        onPick(x / size.width, y / size.height);
      }
    },
    [onPick, size],
  );

  const pan = usePanGesture({
    minDistance: PAN_ACTIVATION_POINTS,
    maxPointers: 1,
    onUpdate: event => {
      'worklet';
      if (event.numberOfPointers === 1) {
        view?.orbit(
          -event.changeX * RADIANS_PER_POINT,
          event.changeY * RADIANS_PER_POINT,
        );
      }
    },
  });
  const pinch = usePinchGesture({
    onUpdate: event => {
      'worklet';
      view?.dolly(event.scaleChange);
    },
  });
  const tap = useTapGesture({
    maxDistance: TAP_MAX_DISTANCE_POINTS,
    onActivate: event => {
      'worklet';
      scheduleOnRN(pick, event.x, event.y);
    },
  });
  const movement = useSimultaneousGestures(pan, pinch);
  // Tap waits for both movement gestures to fail, so dragging cannot pick.
  const gesture = useExclusiveGestures(movement, tap);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <View
          testID="guide-viewport"
          style={styles.root}
          accessible
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Drag to orbit, pinch to zoom, or tap a part to select it."
        >
          <SplatView
            style={styles.root}
            source={source}
            highlight={highlight}
            cameraLimits={limits}
            revealSeconds={
              materialize ? Motion.reveal / MS_PER_SECOND : undefined
            }
            onReady={callback(onReady)}
            onError={callback(onError)}
            hybridRef={callback(onView)}
          />
        </View>
      </GestureDetector>
      {loading && error === '' && (
        <View pointerEvents="none" style={styles.loading}>
          <Label testID="splat-loading" color={Color.muted}>
            {`Loading ${packFacts(pack).splats} splats`}
          </Label>
        </View>
      )}
      {error !== '' && (
        <View pointerEvents="none" style={styles.error}>
          <Icon name={IconName.warn} size={ERROR_ICON} color={Color.caution} />
          <Text
            testID="splat-error"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={styles.errorText}
          >
            {error}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.black },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    position: 'absolute',
    top: Space.md,
    left: Space.md,
    right: Space.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    backgroundColor: Color.surface,
  },
  errorText: { ...Type.footnote, flex: 1, color: Color.text },
});
