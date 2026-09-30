import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
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
import type { Pack } from '../domain/pack';
import { sourceFor } from '../packs/bundledPack';
import { cameraLimitsInRadians } from './camera';
import { Color, FontSize, Space } from './theme';

export const RADIANS_PER_POINT = 0.01;
const PAN_ACTIVATION_POINTS = 8;
const TAP_MAX_DISTANCE_POINTS = 8;

interface Props {
  pack: Pack;
  highlight: number[];
  view: SplatViewSpec | null;
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
  error,
  onView,
  onReady,
  onError,
  onPick,
}: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const source = useMemo(() => sourceFor(pack), [pack]);
  const limits = useMemo(
    () => cameraLimitsInRadians(pack.camera.limits),
    [pack],
  );
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  }, []);
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
          onLayout={onLayout}
          accessibilityLabel="Engine bay. Drag to orbit, pinch to zoom, or tap a part to select it."
        >
          <SplatView
            style={styles.root}
            source={source}
            highlight={highlight}
            cameraLimits={limits}
            onReady={callback(onReady)}
            onError={callback(onError)}
            hybridRef={callback(onView)}
          />
        </View>
      </GestureDetector>
      {error !== '' && (
        <View pointerEvents="none" style={styles.error}>
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
  error: {
    position: 'absolute',
    top: Space.lg,
    left: Space.lg,
    right: Space.lg,
    borderRadius: Space.md,
    padding: Space.lg,
    backgroundColor: Color.surface,
  },
  errorText: { color: Color.text, fontSize: FontSize.body },
});
