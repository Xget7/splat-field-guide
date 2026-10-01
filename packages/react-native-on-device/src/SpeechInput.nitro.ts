import type { HybridObject } from 'react-native-nitro-modules';

/** Whether the app may use the microphone and speech recognition. */
export type SpeechPermission = 'granted' | 'denied' | 'restricted';

/** Whether speech in a locale can be turned into text here, with no network. */
export type SpeechInputAvailability =
  | 'available'
  | 'onDeviceUnsupported'
  | 'unavailable';

/**
 * Push to talk: listens between `start` and `finish`, recognising speech on the device only, so
 * it works in airplane mode.
 */
export interface SpeechInput extends HybridObject<{ ios: 'swift' }> {
  /** Asks for microphone and speech recognition access; once answered, later calls just report it. */
  requestPermission(): Promise<SpeechPermission>;
  availability(locale: string): SpeechInputAvailability;
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
  /** Stops listening and drops what was heard. Safe to call when not listening. */
  cancel(): void;
}
