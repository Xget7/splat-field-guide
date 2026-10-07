import { ConnectionFailure } from '../../events/types';
import { VoiceStartError, VoiceStartFailure } from './voiceSession';

export function voiceFailure(error: unknown): VoiceStartFailure {
  if (error instanceof VoiceStartError) {
    return error.failure;
  }
  const reason = error instanceof Error ? error.message : error;
  if (reason === ConnectionFailure.quota) {
    return VoiceStartFailure.quota;
  }
  if (reason === ConnectionFailure.auth) {
    return VoiceStartFailure.auth;
  }
  if (reason === ConnectionFailure.network) {
    return VoiceStartFailure.network;
  }
  return VoiceStartFailure.failed;
}
export function isConnectionFailure(
  reason: string,
): reason is ConnectionFailure {
  return Object.values(ConnectionFailure).some(value => value === reason);
}
