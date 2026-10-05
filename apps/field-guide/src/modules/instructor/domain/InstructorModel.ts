import type { Pack } from '../../../domain/pack';
import type { SessionState } from '../../../domain/session';
import type { AuthoredEvidence } from './context';
import type { PreviousExchange } from './grounding';

export interface ModelRequest {
  readonly question: string;
  readonly state: SessionState;
  readonly pack: Pack;
  readonly evidence: AuthoredEvidence;
  /** The conversation so far, oldest first; each model keeps as much as it can hold. */
  readonly history: readonly PreviousExchange[];
}

/**
 * A model that can write the instructor's reply. Each one builds its own prompt from the
 * shared grounding, sized to what it can hold; the caller checks and shapes the text.
 */
export interface InstructorModel {
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
