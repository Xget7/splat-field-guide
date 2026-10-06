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
   * Uses a fresh session with greedy decoding; `onPartial` receives the text generated so far.
   * Resolves with the complete text; rejects on unavailability, refusal, generation failure, or cancellation.
   */
  respond(
    instructions: string,
    prompt: string,
    onPartial: (text: string) => void,
  ): Promise<string>;
  /** Stops the answer in progress, which then rejects. Safe to call when idle. */
  cancel(): void;
}
