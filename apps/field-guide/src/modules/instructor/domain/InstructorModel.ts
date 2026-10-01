import type { Pack } from '../../../domain/pack';
import type { SessionState } from '../../../domain/session';
import type { PreviousExchange } from './grounding';

export const ModelName = { cloud: 'cloud', onDevice: 'onDevice' } as const;
export type ModelName = (typeof ModelName)[keyof typeof ModelName];

export interface ModelRequest {
  readonly question: string;
  readonly state: SessionState;
  readonly pack: Pack;
  readonly previous: PreviousExchange | null;
}

/**
 * A model that can write the instructor's reply. Each one builds its own prompt from the
 * shared grounding, sized to what it can hold; the caller checks and shapes the text.
 */
export interface InstructorModel {
  readonly name: ModelName;
  /** Whether a request is worth trying now. Synchronous, so routing never waits. */
  isReady(): boolean;
  /** Gets ready for questions about `pack`, if the model benefits from it. */
  prewarm(pack: Pack): void;
  /**
   * Resolves with the whole reply text. `onText` gets the text so far each time it grows.
   * Rejects when the model fails, times out or is cancelled.
   */
  respond(
    request: ModelRequest,
    onText: (text: string) => void,
  ): Promise<string>;
  /** Stops the reply in progress, which then rejects. Safe to call when idle. */
  cancel(): void;
}
