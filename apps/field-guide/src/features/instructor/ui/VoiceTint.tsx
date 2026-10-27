import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Color, Motion } from '../../../ui/theme';

// Opacity of the tint as it breathes; with reduced motion it holds steady.
const Breath = { low: 0.04, high: 0.11, steady: 0.08, period: 2400 } as const;
const LOOP_FOREVER = -1;

/** Tints the conversation blue and breathes while the instructor listens. */
export function VoiceTint({ listening }: { listening: boolean }) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!listening) {
      opacity.value = withTiming(0, { duration: Motion.base });
    } else if (reducedMotion) {
      opacity.value = Breath.steady;
    } else {
      const half = {
        duration: Breath.period / 2,
        easing: Easing.inOut(Easing.sin),
      };
      opacity.value = withSequence(
        withTiming(Breath.low, { duration: Motion.base }),
        withRepeat(
          withSequence(
            withTiming(Breath.high, half),
            withTiming(Breath.low, half),
          ),
          LOOP_FOREVER,
        ),
      );
    }
    return () => cancelAnimation(opacity);
  }, [listening, reducedMotion, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID="instructor-voice-tint"
      pointerEvents="none"
      accessible={false}
      style={[StyleSheet.absoluteFill, styles.tint, style]}
    />
  );
}

const styles = StyleSheet.create({
  tint: { backgroundColor: Color.accent },
});
