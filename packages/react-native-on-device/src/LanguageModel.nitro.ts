import type { HybridObject } from 'react-native-nitro-modules';

/** Whether the on-device model (Apple Foundation Models) can answer now, and if not, why. */
export type LanguageModelAvailability =
  | 'available'
  | 'deviceNotEligible'
  | 'appleIntelligenceNotEnabled'
  | 'modelNotReady'
  | 'unavailable';

/** One property of the object the model answers with. */
export interface ResponseField {
  name: string;
  description: string;
  /** The only values the model may give, enforced while it generates; empty for free text. */
  choices: string[];
}

/** The on-device language model, answering with a JSON object of a given shape. */
export interface LanguageModel extends HybridObject<{ ios: 'swift' }> {
  availability(): LanguageModelAvailability;
  /** Loads the model for `instructions` ahead of a `respond` that uses the same ones. */
  prewarm(instructions: string): void;
  /**
   * Answers `prompt` as a JSON object whose properties are `fields`, generated in that order.
   * `onPartial` gets the object generated so far, as JSON, each time it grows. Resolves with the
   * complete JSON; rejects when the model is unavailable, refuses, or is cancelled.
   */
  respond(
    instructions: string,
    prompt: string,
    fields: ResponseField[],
    onPartial: (json: string) => void,
  ): Promise<string>;
  /** Stops the answer in progress, which then rejects. Safe to call when idle. */
  cancel(): void;
}
