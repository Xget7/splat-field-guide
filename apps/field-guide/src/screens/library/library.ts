import {
  findReadyGuide,
  type Guide,
  type ReadyGuide,
} from '../../features/pack/catalog';
import { findProcedure, type Procedure } from '../../features/pack/pack';
import type { Progress } from '../../features/guide/progress';
import { TOUR_ID } from '../../features/guide/tour';
import { stepLabel } from '../../ui/readout';

export interface ContinueRow {
  readonly guide: ReadyGuide;
  readonly procedure: Procedure;
  readonly stepIndex: number;
  readonly stepLabel: string;
  readonly fraction: number;
}

export function continueRowFor(
  catalog: readonly Guide[],
  progress: Progress | null,
): ContinueRow | null {
  if (!progress) {
    return null;
  }
  const guide = findReadyGuide(catalog, progress.guideId);
  const procedure = guide && findProcedure(guide.pack, progress.procedureId);
  if (
    !guide ||
    !procedure ||
    !Number.isInteger(progress.stepIndex) ||
    progress.stepIndex < 0 ||
    progress.stepIndex >= procedure.steps.length
  ) {
    return null;
  }
  const stepNumber = progress.stepIndex + 1;
  return {
    guide,
    procedure,
    stepIndex: progress.stepIndex,
    stepLabel: stepLabel(stepNumber, procedure.steps.length),
    fraction: stepNumber / procedure.steps.length,
  };
}

const counted = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/** What a guide holds: its parts, then its authored procedures without the tour. */
export function factsFor(guide: ReadyGuide): readonly string[] {
  const procedures = guide.pack.procedures.filter(
    procedure => procedure.id !== TOUR_ID,
  );
  return [
    counted(guide.pack.parts.length, 'part'),
    counted(procedures.length, 'procedure'),
  ];
}
