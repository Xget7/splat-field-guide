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
  FadeOut,
  LinearTransition,
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
import {
  isLoading,
  StatusLabel,
  useAssistantStatus,
  VoiceStatus,
} from './AssistantStatus';
import { VoiceWave } from './VoiceWave';
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
  Meter,
  meterHeightsFor,
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

const FadeOpacity = { hidden: 0, visible: 1 } as const;

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

function TextStatus({
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
  const status = useAssistantStatus(voice);
  const switching = minimized && isSwitching(mode.mode);
  const idleNotice =
    minimized &&
    mode.notice !== null &&
    voice.state === VoiceState.idle &&
    !live;
  // Compact and idle, the bar names the step; open, the header says whether the assistant is connected.
  if (switching || idleNotice || (minimized && !live)) {
    return (
      <View style={styles.status}>
        <TextStatus
          id="instructor-status"
          status={
            switching || idleNotice
              ? mode.minimizedStatusText
              : status === VoiceStatus.thinking
              ? status
              : step
          }
          color={
            idleNotice && mode.mode === InstructorMode.offline
              ? Color.caution
              : Color.faint
          }
        />
      </View>
    );
  }
  return (
    <View style={styles.status}>
      <ContentFade contentKey={status}>
        <StatusLabel status={status} id="instructor-status" />
      </ContentFade>
      {/* Open, the wave under the thread shows the level instead. */}
      {minimized && !isLoading(status) && <LevelMeter level={voice.level} />}
    </View>
  );
}

export function VoiceBar({
  voice,
  status,
}: {
  voice: InstructorVoice;
  status: VoiceStatus;
}) {
  return (
    <View style={styles.voiceRow}>
      <IconButton
        testID="instructor-voice-end"
        icon={IconName.close}
        accessibilityLabel="End voice"
        accessibilityHint="Goes back to reading and typing"
        size={Composer.button}
        style={composerStyles.quietButton}
        onPress={voice.toggle}
      />
      <VoiceWave voice={voice} status={status} />
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

interface ReplyTextProps {
  id: string;
  text: string;
  leadLength?: number;
  style?: TextStyle;
  numberOfLines?: number;
  accessibilityLabel?: string;
}

export function ReplyText({
  id,
  text,
  leadLength = 0,
  style,
  numberOfLines,
  accessibilityLabel = text,
}: ReplyTextProps) {
  return (
    <Text
      testID={id}
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[styles.reply, style]}
    >
      {leadLength === 0 ? (
        text
      ) : (
        <>
          <Text style={styles.lead}>{text.slice(0, leadLength)}</Text>
          {text.slice(leadLength)}
        </>
      )}
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
  voiceRow: {
    height: Composer.height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
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
  // Distinguish an open microphone from an editable text field.
  open: { borderColor: Color.accent },
  insetButton: { borderRadius: Radius.sm },
  quietButton: {
    borderRadius: Radius.sm,
    borderWidth: 0,
    backgroundColor: Color.pressed,
  },
});
