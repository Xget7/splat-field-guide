import type { HybridObject } from 'react-native-nitro-modules';

/** Reads English with bundled Kokoro, with the best installed system voice as fallback. */
export interface SpeechOutput extends HybridObject<{ ios: 'swift' }> {
  /**
   * Stops anything already being said, then says `text`; resolves when it ends or is stopped.
   * `onWord` gets each word's range in `text`, in UTF-16 code units like a JS string index, during
   * playback. Kokoro estimates each start from word length and the sentence audio duration;
   * the Apple fallback reports its own word callbacks.
   */
  speak(
    text: string,
    locale: string,
    onWord: (location: number, length: number) => void,
  ): Promise<void>;
  /** Stops speaking at once. Safe to call when silent. */
  stop(): void;
}
