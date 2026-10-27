import { VoiceStartFailure } from './voiceSession';

export const VoiceHint = {
  permission: 'Microphone or speech access is denied. You can still type.',
  unavailable:
    'On-device speech recognition is unavailable. You can still type.',
  failed: 'Voice could not start. Try again or type your question.',
  output: 'Speech output is unavailable. You can read the reply here.',
  lost: 'Voice stopped listening. Turn it on to try again.',
} as const;
export const VoiceStartHint = {
  [VoiceStartFailure.permission]: VoiceHint.permission,
  [VoiceStartFailure.unavailable]: VoiceHint.unavailable,
  [VoiceStartFailure.failed]: VoiceHint.failed,
  [VoiceStartFailure.quota]: VoiceHint.failed,
  [VoiceStartFailure.auth]: VoiceHint.failed,
  [VoiceStartFailure.network]: VoiceHint.failed,
} as const;
export const SpeechVoice = { kokoro: 'kokoro', system: 'system' } as const;
export const SpeechPermission = { granted: 'granted' } as const;
export const SpeechAvailability = { available: 'available' } as const;
export const VOICE_LOCALE = 'en-US';
