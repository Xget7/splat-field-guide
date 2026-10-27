import { ConnectionWord } from './mode/modeCopy';
import { InstructorMode, VoiceSource } from './mode/modeTypes';

export const VoiceState = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
} as const;
export type VoiceState = (typeof VoiceState)[keyof typeof VoiceState];

/** What the status words need to know of the voice conversation. */
export interface VoiceActivity {
  readonly state: VoiceState;
  readonly on: boolean;
  readonly muted: boolean;
  readonly open: boolean;
}

export const VoiceStatus = {
  // The agent connecting and the instructor going back online read the same.
  connecting: ConnectionWord.connecting,
  starting: 'Starting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  muted: 'Muted',
} as const;
export type VoiceStatus = (typeof VoiceStatus)[keyof typeof VoiceStatus];

type ConnectionStatus = (typeof ConnectionWord)[keyof typeof ConnectionWord];

/** What the assistant is doing, or whether it is connected while idle. */
export type AssistantStatus = VoiceStatus | ConnectionStatus;

/** How strongly a status word reads; presentation picks the colour. */
export const StatusTone = {
  quiet: 'quiet',
  active: 'active',
  strong: 'strong',
  caution: 'caution',
} as const;
export type StatusTone = (typeof StatusTone)[keyof typeof StatusTone];

const STATUS_TONE: Readonly<Record<AssistantStatus, StatusTone>> = {
  [VoiceStatus.connecting]: StatusTone.quiet,
  [VoiceStatus.starting]: StatusTone.quiet,
  [VoiceStatus.listening]: StatusTone.active,
  [VoiceStatus.thinking]: StatusTone.quiet,
  [VoiceStatus.speaking]: StatusTone.strong,
  [VoiceStatus.muted]: StatusTone.caution,
  [ConnectionWord.online]: StatusTone.active,
  [ConnectionWord.offline]: StatusTone.caution,
};

const CONNECTION: Readonly<Record<InstructorMode, ConnectionStatus>> = {
  [InstructorMode.online]: ConnectionWord.online,
  [InstructorMode.switchingToOnline]: ConnectionWord.connecting,
  [InstructorMode.switchingToOffline]: ConnectionWord.offline,
  [InstructorMode.offline]: ConnectionWord.offline,
};

export function statusToneFor(status: AssistantStatus): StatusTone {
  return STATUS_TONE[status];
}

export function voiceStatusFor(
  voice: VoiceActivity,
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

/** Voice first, then a typed question in progress, then the connection. */
export function assistantStatusFor(
  voice: VoiceActivity,
  mode: InstructorMode,
  source: VoiceSource,
): AssistantStatus {
  if (voice.on) {
    return voiceStatusFor(voice, source);
  }
  return voice.state === VoiceState.thinking
    ? VoiceStatus.thinking
    : CONNECTION[mode];
}

export function isLoading(status: AssistantStatus | null): boolean {
  return status === VoiceStatus.connecting || status === VoiceStatus.starting;
}
