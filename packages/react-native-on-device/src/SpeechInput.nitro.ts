import type { HybridObject } from 'react-native-nitro-modules';

/** Whether the app may use the microphone and speech recognition. */
export type SpeechPermission = 'granted' | 'denied' | 'restricted';

/** Whether speech in a locale can be turned into text here, with no network. */
export type SpeechInputAvailability = 'available' | 'unavailable';

/** Open-microphone listening that recognises speech on the device only, so it works in airplane mode. */
export interface SpeechInput extends HybridObject<{ ios: 'swift' }> {
  /** Asks for microphone and speech recognition access; once answered, later calls just report it. */
  requestPermission(): Promise<SpeechPermission>;
  /**
   * Gets the on-device speech model for a locale ready, downloading it the first time, so
   * listening later needs no network. Call it, and wait, before `listen`.
   */
  prepare(locale: string): Promise<SpeechInputAvailability>;
  /**
   * Listens until `cancel`, with echo cancellation on, so the app's own speech is not heard and
   * the user can talk over it. `hints` are words to favour, such as part names. Each spoken turn
   * ends when the voice pauses: `onPartial` gets its transcript as it grows and `onTurn` the whole
   * of it once. `onLevel` gets the microphone level, 0 for silence to 1 for a loud voice, smoothed
   * and at most 30 times a second. `onVoice` gets true when someone starts talking, over the
   * room's own noise, and false when they pause, just before that turn's `onTurn`. `onStopped`
   * gets the reason if listening ends by itself. Rejects if already listening or not permitted;
   * resolves once listening.
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
