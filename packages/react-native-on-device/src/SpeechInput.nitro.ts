import type { HybridObject } from 'react-native-nitro-modules';

/** Whether the app may use the microphone and speech recognition. */
export type SpeechPermission = 'granted' | 'denied' | 'restricted';

/** Whether speech in a locale can be turned into text here, with no network. */
export type SpeechInputAvailability = 'available' | 'unavailable';

/**
 * Push to talk between `start` and `finish`, or hands free with `listen`, recognising speech on
 * the device only, so it works in airplane mode.
 */
export interface SpeechInput extends HybridObject<{ ios: 'swift' }> {
  /** Asks for microphone and speech recognition access; once answered, later calls just report it. */
  requestPermission(): Promise<SpeechPermission>;
  /**
   * Gets the on-device speech model for a locale ready, downloading it the first time, so
   * listening later needs no network. Call it, and wait, before `start` or `listen`.
   */
  prepare(locale: string): Promise<SpeechInputAvailability>;
  /**
   * Starts listening. `hints` are words to favour, such as part names. `onPartial` gets the whole
   * transcript so far each time it changes. `onLevel` gets the microphone level, 0 for silence to 1
   * for a loud voice, smoothed and at most 30 times a second. Rejects if already listening or not
   * permitted.
   */
  start(
    locale: string,
    hints: string[],
    onPartial: (transcript: string) => void,
    onLevel: (level: number) => void,
  ): Promise<void>;
  /** Stops listening and resolves with the final transcript, '' when nothing was said. */
  finish(): Promise<string>;
  /**
   * Hands free: listens until `cancel`, with echo cancellation on, so the app's own speech is
   * not heard and the user can talk over it. Each spoken turn ends after a pause: `onPartial`
   * gets its transcript as it grows and `onTurn` the whole of it once. `onLevel` is as in
   * `start`. `onStopped` gets the reason if listening ends by itself. Resolves once listening.
   */
  listen(
    locale: string,
    hints: string[],
    onPartial: (transcript: string) => void,
    onTurn: (transcript: string) => void,
    onLevel: (level: number) => void,
    onStopped: (reason: string) => void,
  ): Promise<void>;
  /** Stops listening, held or hands free, and drops what was heard. Safe when not listening. */
  cancel(): void;
}
