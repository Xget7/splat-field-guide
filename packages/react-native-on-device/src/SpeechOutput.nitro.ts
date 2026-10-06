import type { HybridObject } from 'react-native-nitro-modules';

/** Uses bundled English Kokoro on iOS with system fallback, and an installed offline voice on Android. */
export interface SpeechOutput extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Stops anything already being said, then says `text`; resolves when it ends or is stopped.
   * `onWord` receives original UTF-16 ranges during playback, estimated by Kokoro from word length
   * and sentence duration or reported by the system voice.
   */
  speak(
    text: string,
    locale: string,
    onWord: (location: number, length: number) => void,
  ): Promise<void>;
  /** Stops speaking at once. Safe to call when silent. */
  stop(): void;
}
