import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { InstructorMode, VoiceSource } from '../../../features/events/types';
import { useInstructorMode } from '../../../features/events/useAppEvent';
import {
  VoiceState,
  type InstructorVoice,
} from '../../../features/instructor/voice/useInstructorVoice';
import { Label } from '../../../ui/Label';
import { Color, Space } from '../../../ui/theme';

export const VoiceStatus = {
  connecting: 'Connecting',
  starting: 'Starting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  muted: 'Muted',
} as const;
export type VoiceStatus = (typeof VoiceStatus)[keyof typeof VoiceStatus];

export const ConnectionStatus = {
  online: 'Online',
  offline: 'Offline',
  connecting: VoiceStatus.connecting,
} as const;
export type ConnectionStatus =
  (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

/** What the assistant is doing, or whether it is connected while idle. */
export type AssistantStatus = VoiceStatus | ConnectionStatus;

export const STATUS_COLOR: Readonly<Record<AssistantStatus, string>> = {
  [VoiceStatus.connecting]: Color.secondaryText,
  [VoiceStatus.starting]: Color.secondaryText,
  [VoiceStatus.listening]: Color.accent,
  [VoiceStatus.thinking]: Color.secondaryText,
  [VoiceStatus.speaking]: Color.text,
  [VoiceStatus.muted]: Color.caution,
  [ConnectionStatus.online]: Color.accent,
  [ConnectionStatus.offline]: Color.caution,
};

const CONNECTION: Readonly<Record<InstructorMode, ConnectionStatus>> = {
  [InstructorMode.online]: ConnectionStatus.online,
  [InstructorMode.switchingToOnline]: ConnectionStatus.connecting,
  [InstructorMode.switchingToOffline]: ConnectionStatus.offline,
  [InstructorMode.offline]: ConnectionStatus.offline,
};

export function voiceStatusFor(
  voice: InstructorVoice,
  source: VoiceSource,
): VoiceStatus {
  if (voice.state === VoiceState.speaking) {
    return VoiceStatus.speaking;
  }
  if (voice.state === VoiceState.thinking) {
    return VoiceStatus.thinking;
  }
  if (voice.muted) {
    return VoiceStatus.muted;
  }
  if (voice.open) {
    return VoiceStatus.listening;
  }
  return source === VoiceSource.agent
    ? VoiceStatus.connecting
    : VoiceStatus.starting;
}

/** What the voice is doing, or null while voice is off. */
export function useVoiceStatus(voice: InstructorVoice): VoiceStatus | null {
  const { voice: source } = useInstructorMode();
  return voice.on ? voiceStatusFor(voice, source) : null;
}

/** Voice first, then a typed question in progress, then the connection. */
export function useAssistantStatus(voice: InstructorVoice): AssistantStatus {
  const { mode } = useInstructorMode();
  return (
    useVoiceStatus(voice) ??
    (voice.state === VoiceState.thinking
      ? VoiceStatus.thinking
      : CONNECTION[mode])
  );
}

export function isLoading(status: AssistantStatus | null): boolean {
  return status === VoiceStatus.connecting || status === VoiceStatus.starting;
}

/** The status word, with a spinner while the assistant connects. */
export function StatusLabel({
  status,
  id,
}: {
  status: AssistantStatus;
  id: string;
}) {
  return (
    <View style={styles.status}>
      <Label
        testID={id}
        accessibilityLiveRegion="polite"
        color={STATUS_COLOR[status]}
      >
        {status}
      </Label>
      {isLoading(status) && (
        <ActivityIndicator
          testID="instructor-voice-loading"
          size="small"
          color={STATUS_COLOR[status]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
});
