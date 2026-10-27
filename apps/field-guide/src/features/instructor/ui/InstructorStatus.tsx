import { StyleSheet, View } from 'react-native';
import { ContentFade } from '../../../ui/ContentFade';
import { Label } from '../../../ui/Label';
import { Color, Space } from '../../../ui/theme';
import { isSwitching, InstructorMode } from '../domain/mode/modeTypes';
import {
  isLoading,
  StatusLabel,
  useAssistantStatus,
  VoiceStatus,
} from './AssistantStatus';
import { LevelMeter } from './LevelMeter';
import { useModeView } from './useModeView';
import { VoiceState, type InstructorVoice } from './useInstructorVoice';

/** A label that fades in each time its text changes. */
function FadingLabel({
  text,
  color,
  id,
}: {
  text: string | null;
  color: string;
  id: string;
}) {
  return (
    <ContentFade contentKey={text}>
      {text !== null ? (
        <Label testID={id} color={color}>
          {text}
        </Label>
      ) : null}
    </ContentFade>
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
  const notice = switching || idleNotice;
  // Compact and idle, the bar names the step; open, the header says whether the assistant is connected.
  if (notice || (minimized && !live)) {
    return (
      <View style={styles.status}>
        <FadingLabel
          id="instructor-status"
          text={
            notice
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

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
});
