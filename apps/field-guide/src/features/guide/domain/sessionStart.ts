import type { GuideId } from '../../pack/catalog';
import type { ProcedureId } from '../../pack/pack';
import type { LearnMode } from './learningMode';

/** Where a session opens: one step of a guide's procedure, in a learning mode, with voice on or off. */
export interface SessionStart {
  readonly guideId: GuideId;
  readonly procedureId: ProcedureId;
  readonly stepIndex: number;
  readonly mode: LearnMode;
  readonly voice?: boolean;
}
