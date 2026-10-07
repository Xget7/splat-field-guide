import { StyleSheet, Text } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
} from 'react-native-reanimated';
import {
  AnswerSource,
  InstructorMode,
  VoiceSource,
  type ModeStatus,
} from '../../../features/events/types';
import { ModeNoticeCopy } from '../../../features/instructor/mode/modeCopy';
import { Color, Motion, Space, Type } from '../../../ui/theme';

const RULE = 2;
const ENTER = FadeIn.duration(Motion.base);
const EXIT = FadeOut.duration(Motion.base);

export function ModeNotice({ status }: { status: ModeStatus }) {
  const reducedMotion = useReducedMotion();
  const offline = status.mode === InstructorMode.offline;
  const fallback =
    status.mode === InstructorMode.online &&
    status.voice === VoiceSource.device;
  if (!offline && !fallback) {
    return null;
  }
  const title = offline
    ? ModeNoticeCopy.offlineTitle
    : ModeNoticeCopy.voiceFallbackTitle;
  const detail = offline
    ? status.answers === AnswerSource.deviceModel
      ? ModeNoticeCopy.offlineModel
      : ModeNoticeCopy.offlineScript
    : ModeNoticeCopy.voiceFallback;
  return (
    <Animated.View
      entering={reducedMotion ? undefined : ENTER}
      exiting={reducedMotion ? undefined : EXIT}
      style={[styles.notice, offline && styles.offline]}
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderLeftWidth: RULE,
    borderLeftColor: Color.lineStrong,
    paddingLeft: Space.md,
    paddingVertical: Space.sm,
    gap: Space.xs,
  },
  offline: { borderLeftColor: Color.caution },
  title: { ...Type.calloutStrong, color: Color.text },
  detail: { ...Type.footnote, color: Color.secondaryText },
});
