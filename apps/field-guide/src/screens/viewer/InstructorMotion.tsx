import { useEffect } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInUp,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { IconButton, IconButtonVariant, IconName, Label } from '../../ui/kit';
import { Color, HAIRLINE, Motion, Radius, Space, Type } from '../../ui/theme';
import {
  karaokeSpans,
  Meter,
  meterHeightsFor,
  normalizedLevel,
  SpanKind,
  type WordRange,
} from '../../voice/speechPresentation';
import {
  VoiceState,
  type InstructorVoice,
} from '../../voice/useInstructorVoice';

export function panelLayout() {
  return LinearTransition.springify()
    .mass(Motion.spring.mass)
    .damping(Motion.spring.damping)
    .stiffness(Motion.spring.stiffness)
    .overshootClamping(Number(Motion.spring.overshootClamping));
}
export const PANEL_LAYOUT = panelLayout();
export const FADE_IN = FadeIn.duration(Motion.base).reduceMotion(
  ReduceMotion.Never,
);
export const FADE_OUT = FadeOut.duration(Motion.fast).reduceMotion(
  ReduceMotion.Never,
);
export const PART_RISE = Space.sm;
export const PART_ENTER = FadeInUp.duration(Motion.base).withInitialValues({
  opacity: 0,
  transform: [{ translateY: PART_RISE }],
});
const PRESS_SCALE = 0.94;
const PRESS_OPACITY = 0.8;
const RING_GROWTH = 0.25;
const RING_MIN_OPACITY = 0.2;
const RING_LEVEL_OPACITY = 0.6;
const SCAN_SHARE = 1 / 3;
const SCAN_WIDTH = '33.333333%';
const SCAN_HEIGHT = 2;
const LOOP_FOREVER = -1;

const STATUS: Readonly<Record<VoiceState, string>> = {
  idle: '',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};
const SPAN_COLOR: Readonly<Record<SpanKind, string>> = {
  spoken: Color.text,
  current: Color.accent,
  remaining: Color.muted,
};

interface MeterProps {
  level: SharedValue<number>;
}

function MeterBar({ level, index }: MeterProps & { index: number }) {
  const style = useAnimatedStyle(() => ({
    height: meterHeightsFor(level.value)[index],
  }));
  return (
    <Animated.View
      testID={`instructor-meter-bar-${index}`}
      style={[styles.bar, style]}
    />
  );
}

export function LevelMeter({ level }: MeterProps) {
  return (
    <View testID="instructor-meter" accessible={false} style={styles.meter}>
      {Meter.weights.map((_, index) => (
        <MeterBar key={index} index={index} level={level} />
      ))}
    </View>
  );
}

export function InstructorStatus({
  voice,
  step,
}: {
  voice: InstructorVoice;
  step: string | null;
}) {
  const status = STATUS[voice.state] || step;
  const metered =
    voice.state === VoiceState.listening || voice.state === VoiceState.speaking;
  return (
    <Animated.View
      key={status}
      entering={FADE_IN}
      exiting={FADE_OUT}
      style={styles.status}
    >
      {status !== null && (
        <Label testID="instructor-status" color={Color.faint}>
          {status}
        </Label>
      )}
      {metered && <LevelMeter level={voice.level} />}
    </Animated.View>
  );
}

export function InstructorScan({
  active,
  reducedMotion,
}: {
  active: boolean;
  reducedMotion: boolean;
}) {
  const progress = useSharedValue(0);
  const width = useSharedValue(0);
  useEffect(() => {
    if (active && !reducedMotion) {
      progress.value = 0;
      progress.value = withRepeat(
        withTiming(1, {
          duration: Motion.scanPeriod,
          easing: Easing.inOut(Easing.ease),
        }),
        LOOP_FOREVER,
      );
    } else {
      cancelAnimation(progress);
      progress.value = 0;
    }
    return () => cancelAnimation(progress);
  }, [active, reducedMotion, progress]);
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          progress.value * width.value * (1 + SCAN_SHARE) -
          width.value * SCAN_SHARE,
      },
    ],
  }));
  if (!active) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      testID="instructor-scan"
      style={styles.scanTrack}
      onLayout={event => {
        width.value = event.nativeEvent.layout.width;
      }}
    >
      {reducedMotion ? (
        <View testID="instructor-scan-static" style={styles.staticScan} />
      ) : (
        <Animated.View
          testID="instructor-scan-sweep"
          style={[styles.sweep, style]}
        />
      )}
    </View>
  );
}

export function InstructorTalk({
  voice,
  size,
  reducedMotion,
  onHoldChange,
}: {
  voice: InstructorVoice;
  size: number;
  reducedMotion: boolean;
  /** Told when a finger lands on the button and when it lifts. */
  onHoldChange?: (holding: boolean) => void;
}) {
  const pressed = useSharedValue(0);
  const listening = voice.state === VoiceState.listening;
  const { level } = voice;
  const pressStyle = useAnimatedStyle(() =>
    reducedMotion
      ? { opacity: 1 - pressed.value * (1 - PRESS_OPACITY) }
      : { transform: [{ scale: 1 - pressed.value * (1 - PRESS_SCALE) }] },
  );
  const ringStyle = useAnimatedStyle(() => ({
    opacity: listening
      ? RING_MIN_OPACITY + normalizedLevel(level.value) * RING_LEVEL_OPACITY
      : 0,
    transform: reducedMotion
      ? []
      : [{ scale: 1 + normalizedLevel(level.value) * RING_GROWTH }],
  }));
  const press = (value: number) => {
    pressed.value = reducedMotion
      ? withTiming(value, {
          duration: Motion.fast,
          reduceMotion: ReduceMotion.Never,
        })
      : withSpring(value, Motion.spring);
  };
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View
        pointerEvents="none"
        testID="instructor-talk-ring"
        style={[styles.ring, { borderRadius: size / 2 }, ringStyle]}
      />
      <Animated.View testID="instructor-talk-motion" style={pressStyle}>
        <IconButton
          testID="instructor-talk"
          icon={IconName.mic}
          size={size}
          variant={IconButtonVariant.active}
          accessibilityLabel="Hold to talk to the instructor"
          accessibilityHint="Hold while speaking, then release to ask"
          accessibilityState={{
            selected: listening,
            disabled: !voice.canListen,
          }}
          disabled={!voice.canListen}
          onPressIn={() => {
            press(1);
            onHoldChange?.(true);
            return voice.start();
          }}
          onPressOut={() => {
            press(0);
            onHoldChange?.(false);
            voice.release();
          }}
          style={
            listening
              ? { ...styles.listening, borderRadius: size / 2 }
              : { borderRadius: size / 2 }
          }
        />
      </Animated.View>
    </View>
  );
}

interface KaraokeProps {
  id: string;
  text: string;
  word: WordRange | null;
  speaking: boolean;
  style?: TextStyle;
  numberOfLines?: number;
}

export function KaraokeText({
  id,
  text,
  word,
  speaking,
  style,
  numberOfLines,
}: KaraokeProps) {
  const spans = karaokeSpans(text, word, speaking);
  return (
    <Text
      testID={id}
      numberOfLines={numberOfLines}
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      style={[styles.reply, style]}
    >
      {speaking
        ? spans.map((span, index) => (
            <Text
              key={`${span.kind}-${index}`}
              testID={`${id}-${span.kind}`}
              style={{ color: SPAN_COLOR[span.kind] }}
            >
              {span.text}
            </Text>
          ))
        : text}
    </Text>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  meter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Meter.gap,
    height: Meter.maxHeight,
  },
  bar: {
    width: Meter.width,
    backgroundColor: Color.accent,
    borderRadius: Meter.radius,
  },
  scanTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCAN_HEIGHT,
    overflow: 'hidden',
  },
  sweep: {
    width: SCAN_WIDTH,
    height: SCAN_HEIGHT,
    backgroundColor: Color.accent,
  },
  staticScan: { height: SCAN_HEIGHT, backgroundColor: Color.accent },
  ring: {
    ...StyleSheet.absoluteFill,
    borderWidth: HAIRLINE,
    borderColor: Color.accent,
    borderRadius: Radius.md,
  },
  listening: { backgroundColor: Color.accentPressed },
  reply: { ...Type.body, color: Color.text },
});
