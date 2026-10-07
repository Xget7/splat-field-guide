import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  LinearTransition,
  SlideInRight,
  SlideOutRight,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { IconButton, IconButtonVariant } from '../../../ui/Button';
import { InstructorMode } from '../../../features/events/types';
import { isSwitching } from '../../../features/events/mode';
import { useModeView } from './useModeView';
import { IconName } from '../../../ui/Icon';
import { Label } from '../../../ui/Label';
import {
  BUTTON_HEIGHT,
  Color,
  Font,
  HAIRLINE,
  Motion,
  Radius,
  Space,
  Type,
} from '../../../ui/theme';
import {
  karaokeSpans,
  Meter,
  meterHeightsFor,
  SpanKind,
  type WordRange,
} from '../../../features/instructor/voice/speechPresentation';
import {
  VoiceState,
  type InstructorVoice,
} from '../../../features/instructor/voice/useInstructorVoice';

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
export const SIDEBAR_IN = SlideInRight.springify()
  .mass(Motion.spring.mass)
  .damping(Motion.spring.damping)
  .stiffness(Motion.spring.stiffness);
export const SIDEBAR_OUT = SlideOutRight.duration(Motion.base);
export const DOCK_IN = FadeInDown.springify()
  .mass(Motion.spring.mass)
  .damping(Motion.spring.damping)
  .stiffness(Motion.spring.stiffness)
  .delay(Motion.fast);
export const DOCK_OUT = FadeOutDown.duration(Motion.fast);
const SCAN_SHARE = 1 / 3;
const SCAN_WIDTH = '33.333333%';
const SCAN_HEIGHT = 2;
const LOOP_FOREVER = -1;

// Match the Next button's height so composer and navigation rows align.
export const Composer = {
  height: BUTTON_HEIGHT,
  button: 36,
  inset: (BUTTON_HEIGHT - 36) / 2,
} as const;

const STATUS: Readonly<Record<VoiceState, string>> = {
  idle: '',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};
const MicStatus = {
  open: 'Listening',
  muted: 'Muted',
  starting: 'Starting',
} as const;
const FadeOpacity = { hidden: 0, visible: 1 } as const;
function statusColor(status: string | null) {
  if (status === MicStatus.muted) {
    return Color.caution;
  }
  if (status === STATUS.speaking) {
    return Color.text;
  }
  return status === MicStatus.open ? Color.accent : Color.faint;
}

function voiceStatus(voice: InstructorVoice): string {
  if (STATUS[voice.state] !== '') {
    return STATUS[voice.state];
  }
  if (voice.muted) {
    return MicStatus.muted;
  }
  return voice.open ? MicStatus.open : MicStatus.starting;
}

export function ContentFade({
  contentKey,
  children,
  style,
}: {
  contentKey: string | number | null;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  const hasContent = children != null && typeof children !== 'boolean';
  const opacity = useSharedValue<number>(FadeOpacity.hidden);
  const fadingKey = useSharedValue(contentKey);
  useLayoutEffect(() => {
    cancelAnimation(opacity);
    opacity.value = FadeOpacity.hidden;
    fadingKey.value = contentKey;
    if (hasContent) {
      opacity.value = reducedMotion
        ? FadeOpacity.visible
        : withTiming(FadeOpacity.visible, {
            duration: Motion.fast,
            easing: Easing.out(Easing.exp),
          });
    }
    return () => cancelAnimation(opacity);
  }, [contentKey, hasContent, reducedMotion, opacity, fadingKey]);
  // A replacement cannot inherit the previous content's animated opacity.
  const fade = useAnimatedStyle(() => ({
    opacity: reducedMotion
      ? FadeOpacity.visible
      : fadingKey.value === contentKey
      ? opacity.value
      : FadeOpacity.hidden,
  }));
  return !hasContent ? null : (
    <Animated.View style={[style, fade]}>{children}</Animated.View>
  );
}

function StatusLabel({
  status,
  color,
  id,
}: {
  status: string | null;
  color: string;
  id: string;
}) {
  return (
    <ContentFade contentKey={status}>
      {status !== null ? (
        <Label testID={id} color={color}>
          {status}
        </Label>
      ) : null}
    </ContentFade>
  );
}

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
  live,
  minimized = false,
}: {
  voice: InstructorVoice;
  step: string | null;
  live: boolean;
  minimized?: boolean;
}) {
  const mode = useModeView();
  const thinking = voice.state === VoiceState.thinking;
  const switching = minimized && isSwitching(mode.mode);
  const idleNotice =
    minimized &&
    mode.notice !== null &&
    voice.state === VoiceState.idle &&
    !live;
  let status = step;
  if (live) {
    status = voiceStatus(voice);
  } else if (thinking) {
    status = STATUS.thinking;
  }
  if (switching || idleNotice) {
    status = mode.minimizedStatusText;
  }
  return (
    <View style={styles.status}>
      <StatusLabel
        id="instructor-status"
        status={status}
        color={
          idleNotice && mode.mode === InstructorMode.offline
            ? Color.caution
            : statusColor(status)
        }
      />
      {live && <LevelMeter level={voice.level} />}
    </View>
  );
}

export function VoiceBar({ voice }: { voice: InstructorVoice }) {
  const status = voiceStatus(voice);
  return (
    <View
      style={[
        composerStyles.frame,
        composerStyles.voiceFrame,
        voice.open && composerStyles.open,
        voice.muted && composerStyles.mutedFrame,
      ]}
    >
      <IconButton
        testID="instructor-voice-end"
        icon={IconName.close}
        accessibilityLabel="End voice"
        accessibilityHint="Goes back to reading and typing"
        size={Composer.button}
        style={composerStyles.quietButton}
        onPress={voice.toggle}
      />
      <View
        testID="instructor-voice-bar"
        accessibilityLabel={`Voice: ${status}`}
        accessibilityLiveRegion="polite"
        style={styles.voiceReadout}
      >
        <StatusLabel
          id="instructor-voice-status"
          status={status}
          color={statusColor(status)}
        />
        <LevelMeter level={voice.level} />
      </View>
      <MuteButton voice={voice} inset />
    </View>
  );
}

export function MuteButton({
  voice,
  inset = false,
}: {
  voice: InstructorVoice;
  /** The composer already provides the outline when this control is inset. */
  inset?: boolean;
}) {
  return (
    <IconButton
      testID="instructor-mute"
      icon={voice.muted ? IconName.micOff : IconName.mic}
      variant={
        voice.muted ? IconButtonVariant.raised : IconButtonVariant.active
      }
      accessibilityLabel={
        voice.muted ? 'Unmute the microphone' : 'Mute the microphone'
      }
      accessibilityState={{ selected: !voice.muted }}
      size={inset ? Composer.button : undefined}
      onPress={voice.toggleMuted}
      style={
        inset
          ? voice.muted
            ? composerStyles.quietButton
            : composerStyles.insetButton
          : voice.muted
          ? styles.muted
          : undefined
      }
    />
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

interface KaraokeProps {
  id: string;
  text: string;
  word: WordRange | null;
  speaking: boolean;
  location?: number;
  speechLength?: number;
  leadLength?: number;
  style?: TextStyle;
  numberOfLines?: number;
  accessibilityLabel?: string;
}

export function KaraokeText({
  id,
  text,
  word,
  speaking,
  location = 0,
  speechLength,
  leadLength = 0,
  style,
  numberOfLines,
  accessibilityLabel = text,
}: KaraokeProps) {
  const spans = karaokeSpans(text, word, speaking, location, speechLength);
  const withLead = (words: string, start: number) => {
    const end = Math.max(0, leadLength - start);
    return end === 0 ? (
      words
    ) : (
      <>
        <Text style={styles.lead}>{words.slice(0, end)}</Text>
        {words.slice(end)}
      </>
    );
  };
  let offset = 0;
  return (
    <Text
      testID={id}
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[styles.reply, style]}
    >
      {speaking
        ? spans.map((span, index) => {
            const start = offset;
            offset += span.text.length;
            return (
              <Text
                key={`${span.kind}-${index}`}
                testID={`${id}-${span.kind}`}
                style={{ color: SPAN_COLOR[span.kind] }}
              >
                {withLead(span.text, start)}
              </Text>
            );
          })
        : withLead(text, 0)}
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
  voiceReadout: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.sm,
  },
  muted: { borderWidth: HAIRLINE, borderColor: Color.caution },
  reply: { ...Type.body, color: Color.text },
  lead: { fontFamily: Font.semiBold },
});

export const composerStyles = StyleSheet.create({
  frame: {
    height: Composer.height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingLeft: Space.md,
    paddingRight: Composer.inset,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    backgroundColor: Color.raised,
  },
  voiceFrame: { paddingLeft: Composer.inset },
  // Distinguish an open microphone from an editable text field.
  open: { borderColor: Color.accent },
  mutedFrame: { borderColor: Color.caution },
  insetButton: { borderRadius: Radius.sm },
  quietButton: {
    borderRadius: Radius.sm,
    borderWidth: 0,
    backgroundColor: Color.pressed,
  },
});
