import type { HybridObject } from 'react-native-nitro-modules';

/** Whether the on-device model (Apple Foundation Models) can answer now, and if not, why. */
export type LanguageModelAvailability =
  | 'available'
  | 'deviceNotEligible'
  | 'appleIntelligenceNotEnabled'
  | 'modelNotReady'
  | 'unavailable';

/** The on-device language model, answering in plain text. */
export interface LanguageModel extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  availability(): LanguageModelAvailability;
  /** Loads the model for `instructions` ahead of a `respond` that uses the same ones. */
  prewarm(instructions: string): void;
  /**
   * Answers `prompt` in a fresh session with greedy decoding, so the same question gets the
   * same grounded answer. `onPartial` gets the text generated so far each time it grows.
   * Resolves with the complete text; rejects when the model is unavailable, refuses, or is
   * cancelled.
   */
  respond(
    instructions: string,
    prompt: string,
    onPartial: (text: string) => void,
  ): Promise<string>;
  /** Stops the answer in progress, which then rejects. Safe to call when idle. */
  cancel(): void;
}
