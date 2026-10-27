import type { Pack } from '../../../pack/pack';
import type { SessionState } from '../../../guide';
import type { AuthoredEvidence } from '../context';
import type { PreviousExchange } from '../grounding';

export interface AnswerRequest {
  readonly question: string;
  readonly state: SessionState;
  readonly pack: Pack;
  readonly evidence: AuthoredEvidence;
  /** The conversation so far, oldest first; each answerer keeps as much as it can hold. */
  readonly history: readonly PreviousExchange[];
}

/**
 * Answers one question from the instructor's grounding, online or on the device. Each answerer
 * sizes its prompt from shared grounding; the turn runner validates and shapes its output.
 */
export interface Answerer {
  /** Whether a request is worth trying now. Synchronous, so routing never waits. */
  isReady(): boolean;
  prewarm(pack: Pack): void;
  /** Stream cumulative text through onText, then resolve the full reply or reject on failure or cancellation. */
  respond(
    request: AnswerRequest,
    onText: (text: string) => void,
  ): Promise<string>;
  /** Cancellation rejects an active reply and is safe when idle. */
  cancel(): void;
}
