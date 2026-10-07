import type { HybridObject } from 'react-native-nitro-modules';

/** Kokoro falls back to the system voice on iOS; Android always uses the system voice. */
export type SpeechVoice = 'kokoro' | 'system';

/** Uses bundled English Kokoro on iOS with system fallback, and an installed offline voice on Android. */
export interface SpeechOutput
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Stops anything already being said, then says `text`; resolves when it ends or is stopped.
   * `onWord` receives original UTF-16 ranges during playback, estimated by Kokoro from word length
   * and sentence duration or reported by the system voice.
   */
  speak(
    text: string,
    locale: string,
    onWord: (location: number, length: number) => void,
    voice: SpeechVoice,
  ): Promise<void>;
  /** Loads voice and resolves with the voice that will actually speak. */
  prepare(voice: SpeechVoice): Promise<SpeechVoice>;
  /** Stops speaking at once. Safe to call when silent. */
  stop(): void;
}
