import type { GuideId } from '../../pack/catalog';
import type { ProcedureId } from '../../pack/pack';
import type { LearnMode } from './learningMode';

/** A null procedure opens free exploration without course progress or guidance. */
export interface SessionStart {
  readonly guideId: GuideId;
  readonly procedureId: ProcedureId | null;
  readonly stepIndex: number;
  readonly mode: LearnMode;
  readonly voice?: boolean;
  readonly selectedPart?: string;
  readonly selectedParts?: readonly string[];
}
