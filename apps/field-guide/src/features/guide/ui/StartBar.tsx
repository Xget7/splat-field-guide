import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { LearnMode } from '../domain/learningMode';
import { Button } from '../../../ui/Button';
import { Icon, IconName } from '../../../ui/Icon';
import {
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Motion,
  Radius,
  Space,
  Type,
} from '../../../ui/theme';
import type { TourSummary } from '../domain/courseOutline';
import { MODE_OPTIONS } from './guideDetail';

const Layout = {
  modeIcon: 16,
  rowIcon: 20,
  toggleWidth: 44,
  toggleHeight: 26,
  knob: 20,
} as const;
const VOICE_TITLE = 'Voice assistant';
const VOICE_CAPTION =
  'Reads each step aloud and listens. Talk over it to cut in.';
const TOGGLE_MOTION = LinearTransition.duration(Motion.fast);

interface Props {
  readonly mode: LearnMode;
  readonly onMode: (mode: LearnMode) => void;
  readonly voice: boolean;
  readonly onVoice: (voice: boolean) => void;
  /** What the tour covers, read just before starting it. */
  readonly tour: TourSummary | null;
  readonly onStart: () => void;
}

/** How the course starts: guidance mode, voice for the instructor, then the parts tour. */
export function StartBar({
  mode,
  onMode,
  voice,
  onVoice,
  tour,
  onStart,
}: Props) {
  const instructor = mode === LearnMode.instructor;
  return (
    <View style={styles.bar}>
      <View accessibilityLabel="Guidance mode" style={styles.segments}>
        {MODE_OPTIONS.map(option => {
          const active = option.mode === mode;
          return (
            <Pressable
              key={option.mode}
              testID={option.testID}
              accessibilityRole="button"
              accessibilityLabel={option.title}
              accessibilityHint={option.caption}
              accessibilityState={{ selected: active }}
              onPress={() => onMode(option.mode)}
              style={[styles.segment, active && styles.activeSegment]}
            >
              <Icon
                name={option.icon}
                size={Layout.modeIcon}
                color={active ? Color.text : Color.secondaryText}
              />
              <Text style={[styles.segmentText, active && styles.activeText]}>
                {option.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* Voice belongs to the instructor, so self-guided offers no voice choice. */}
      {instructor && (
        <Pressable
          testID="voice-assistant"
          accessibilityRole="switch"
          accessibilityLabel={VOICE_TITLE}
          accessibilityHint={VOICE_CAPTION}
          accessibilityState={{ checked: voice }}
          onPress={() => onVoice(!voice)}
          style={styles.voice}
        >
          <Icon
            name={IconName.handsFree}
            size={Layout.rowIcon}
            color={voice ? Color.accent : Color.secondaryText}
          />
          <Text style={styles.voiceTitle}>{VOICE_TITLE}</Text>
          {/* The custom switch avoids the iOS 26 switch exceeding its React Native frame. */}
          <View style={[styles.toggle, voice && styles.toggleOn]}>
            <Animated.View layout={TOGGLE_MOTION} style={styles.knob} />
          </View>
        </Pressable>
      )}
      {tour && (
        <Text testID="tour-summary" style={styles.tour}>
          {tour.objective ? `${tour.objective} ` : ''}
          <Text style={styles.steps}>{tour.steps}</Text>
        </Text>
      )}
      <Button
        testID="start-tour"
        label="Start parts tour"
        accessibilityLabel="Start parts tour"
        onPress={onStart}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: Space.sm },
  segments: {
    flexDirection: 'row',
    padding: Space.xxs,
    borderRadius: Radius.control,
    backgroundColor: Color.field,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH - Space.xxs * 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    borderRadius: Radius.control - Space.xxs,
  },
  activeSegment: {
    backgroundColor: Color.pressed,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
  },
  segmentText: { ...Type.calloutStrong, color: Color.secondaryText },
  activeText: { color: Color.text },
  tour: { ...Type.footnote, color: Color.secondaryText },
  steps: { color: Color.muted },
  voice: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  voiceTitle: { ...Type.callout, flex: 1, color: Color.text },
  toggle: {
    width: Layout.toggleWidth,
    height: Layout.toggleHeight,
    borderRadius: Radius.round,
    padding: (Layout.toggleHeight - HAIRLINE * 2 - Layout.knob) / 2,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    backgroundColor: Color.pressed,
    alignItems: 'flex-start',
  },
  toggleOn: {
    borderColor: Color.accent,
    backgroundColor: Color.accentFill,
    alignItems: 'flex-end',
  },
  knob: {
    width: Layout.knob,
    height: Layout.knob,
    borderRadius: Radius.round,
    backgroundColor: Color.accentText,
  },
});
