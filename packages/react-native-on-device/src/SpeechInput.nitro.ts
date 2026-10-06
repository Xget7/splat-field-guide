import type { HybridObject } from 'react-native-nitro-modules';

/** Whether the app may use the microphone and speech recognition. */
export type SpeechPermission = 'granted' | 'denied' | 'restricted';

/** Locale readiness; Android service availability alone does not guarantee offline recognition. */
export type SpeechInputAvailability = 'available' | 'unavailable';

/** Continuous on-device listening on iOS; Android prefers on-device recognition and otherwise requests offline service. */
export interface SpeechInput
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** Asks for microphone and speech recognition access; once answered, later calls just report it. */
  requestPermission(): Promise<SpeechPermission>;
  /**
   * Prepares locale assets where supported; await readiness before `listen`.
   */
  prepare(locale: string): Promise<SpeechInputAvailability>;
  /**
   * Listens until `cancel` or audio/recognition loss; `hints` bias recognition toward supplied words.
   * iOS shares Kokoro playback for echo cancellation; system speech needs caller-side echo filtering.
   * `onPartial` receives growing text and `onTurn` receives each settled nonempty turn once.
   * iOS turns follow acoustic pauses; Android turns follow recognition-service results.
   * `onLevel` receives smoothed levels from 0 to 1 at most 30 times a second.
   * `onVoice` reports voice onset and end before turn delivery; iOS measures onset against room noise.
   * `onStopped` receives the reason for spontaneous loss; explicit cancellation discards the turn.
   * Rejects if unprepared, already listening, or not permitted; resolves once listening.
   */
  listen(
    locale: string,
    hints: string[],
    onPartial: (transcript: string) => void,
    onTurn: (transcript: string) => void,
    onLevel: (level: number) => void,
    onVoice: (speaking: boolean) => void,
    onStopped: (reason: string) => void,
  ): Promise<void>;
  /** Stops listening and drops what was heard. Safe when not listening. */
  cancel(): void;
}
