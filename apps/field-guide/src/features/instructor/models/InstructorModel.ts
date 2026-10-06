import type { Pack } from '../../pack/pack';
import type { SessionState } from '../../guide/session';
import type { AuthoredEvidence } from '../context';
import type { PreviousExchange } from '../grounding';

export interface ModelRequest {
  readonly question: string;
  readonly state: SessionState;
  readonly pack: Pack;
  readonly evidence: AuthoredEvidence;
  /** The conversation so far, oldest first; each model keeps as much as it can hold. */
  readonly history: readonly PreviousExchange[];
}

/** Each model sizes its prompt from shared grounding; the caller validates and shapes its output. */
export interface InstructorModel {
  /** Whether a request is worth trying now. Synchronous, so routing never waits. */
  isReady(): boolean;
  prewarm(pack: Pack): void;
  /** Stream cumulative text through onText, then resolve the full reply or reject on failure or cancellation. */
  respond(
    request: ModelRequest,
    onText: (text: string) => void,
  ): Promise<string>;
  /** Cancellation rejects an active reply and is safe when idle. */
  cancel(): void;
}
