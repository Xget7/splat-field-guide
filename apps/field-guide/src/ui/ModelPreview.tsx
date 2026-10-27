import { useMemo, useState, type ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { callback } from 'react-native-nitro-modules';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ModelView } from 'react-native-splat';

const FADE_IN = 600;

/** How a preview turns: degrees through, and seconds per cycle. */
export interface Turn {
  readonly sweep: number;
  readonly period: number;
}

export const Turns = {
  /** Full turns, for an object modelled all round. */
  spin: { sweep: 360, period: 28 },
  /** Either side of the front, for a capture with no back. */
  sway: { sweep: 70, period: 16 },
} as const satisfies Record<string, Turn>;

/**
 * A bundled USDZ model turning in place, faded in once it draws.
 * The fallback shows where the model cannot: on Android, or when the file is missing.
 */
export function ModelPreview({
  path,
  turn,
  style = StyleSheet.absoluteFill,
  fallback = null,
}: {
  path: string | undefined;
  turn: Turn;
  /** Where the model turns; it fills its parent by default. */
  style?: StyleProp<ViewStyle>;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const opacity = useSharedValue(0);
  const onLoaded = useMemo(
    () =>
      callback((loaded: boolean) => {
        if (!loaded) {
          setFailed(true);
          return;
        }
        opacity.value = withTiming(1, {
          duration: FADE_IN,
          easing: Easing.out(Easing.cubic),
        });
      }),
    [opacity],
  );
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (Platform.OS !== 'ios' || path === undefined || failed) {
    return fallback;
  }
  return (
    <Animated.View pointerEvents="none" style={[style, fade]}>
      <ModelView
        style={StyleSheet.absoluteFill}
        modelPath={path}
        sweep={turn.sweep}
        period={turn.period}
        onLoaded={onLoaded}
      />
    </Animated.View>
  );
}
