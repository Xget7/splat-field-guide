import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { normalizedLevel } from '../../../features/instructor/voice/speechPresentation';
import type { InstructorVoice } from '../../../features/instructor/voice/useInstructorVoice';
import { Color, Motion } from '../../../ui/theme';
import { isLoading, STATUS_COLOR, type VoiceStatus } from './AssistantStatus';

const Wave = {
  bars: 28,
  barWidth: 3,
  minHeight: 4,
  maxHeight: 28,
  // Edge bars keep this share of the centre's height.
  edge: 0.35,
  // Share of each bar's height that ripples across the wave.
  ripple: 0.5,
  // Phase between neighbouring bars, in radians.
  step: 0.55,
  period: 1400,
} as const;
// While connecting, a bump of this width and height sweeps across the bars.
const Sweep = { width: 0.18, peak: 0.6, margin: 0.2 } as const;
const Breath = { low: 0.04, high: 0.11, steady: 0.08, period: 2400 } as const;
const FULL_TURN = 2 * Math.PI;
const LOOP_FOREVER = -1;
const HALF = 0.5;

const ENVELOPE = Array.from(
  { length: Wave.bars },
  (_, index) =>
    Wave.edge +
    (1 - Wave.edge) * Math.sin((Math.PI * (index + HALF)) / Wave.bars),
);

function Bar({
  index,
  level,
  phase,
  loading,
  color,
}: {
  index: number;
  level: SharedValue<number>;
  phase: SharedValue<number>;
  loading: SharedValue<number>;
  color: string;
}) {
  const envelope = ENVELOPE[index];
  const style = useAnimatedStyle(() => {
    const turn = phase.value / FULL_TURN;
    const ripple =
      1 -
      Wave.ripple +
      Wave.ripple * (HALF + HALF * Math.sin(phase.value + index * Wave.step));
    const sound = normalizedLevel(level.value) * envelope * ripple;
    const position = turn * (1 + 2 * Sweep.margin) - Sweep.margin;
    const distance = Math.abs(index / (Wave.bars - 1) - position);
    const sweep = Math.max(0, 1 - distance / Sweep.width) * Sweep.peak;
    return {
      height:
        Wave.minHeight +
        (Wave.maxHeight - Wave.minHeight) *
          (sound * (1 - loading.value) + sweep * loading.value),
    };
  });
  return (
    <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />
  );
}

/** A horizontal sound wave in place of the text field while voice is on. */
export function VoiceWave({
  voice,
  status,
}: {
  voice: InstructorVoice;
  status: VoiceStatus;
}) {
  const reducedMotion = useReducedMotion();
  const phase = useSharedValue(0);
  const loading = useSharedValue(isLoading(status) ? 1 : 0);
  const moving = voice.on && !reducedMotion;
  useEffect(() => {
    if (moving) {
      phase.value = 0;
      phase.value = withRepeat(
        withTiming(FULL_TURN, { duration: Wave.period, easing: Easing.linear }),
        LOOP_FOREVER,
      );
    }
    return () => cancelAnimation(phase);
  }, [moving, phase]);
  useEffect(() => {
    loading.value = withTiming(isLoading(status) ? 1 : 0, {
      duration: Motion.base,
    });
  }, [status, loading]);
  return (
    <View
      testID="instructor-voice-bar"
      accessibilityLabel={`Voice: ${status}`}
      style={styles.wave}
    >
      {ENVELOPE.map((_, index) => (
        <Bar
          key={index}
          index={index}
          level={voice.level}
          phase={phase}
          loading={loading}
          color={STATUS_COLOR[status]}
        />
      ))}
    </View>
  );
}

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
  wave: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bar: { width: Wave.barWidth, borderRadius: Wave.barWidth / 2 },
  tint: { backgroundColor: Color.accent },
});
