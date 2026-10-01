import type { Pack, ProcedureId } from '../../../domain/pack';
import { twoDigits } from '../../../shared/ui/readout';

export interface ProcedureRow {
  readonly id: ProcedureId;
  readonly index: string;
  readonly title: string;
  readonly stepsLabel: string;
  readonly hasCaution: boolean;
  readonly accessibilityLabel: string;
}

export function procedureRowsFor(pack: Pack): ProcedureRow[] {
  return pack.procedures.map((procedure, index) => {
    const count = procedure.steps.length;
    const stepsLabel = `${count} ${count === 1 ? 'step' : 'steps'}`;
    const hasCaution = procedure.steps.some(
      step => step.caution.trim().length > 0,
    );
    return {
      id: procedure.id,
      index: twoDigits(index + 1),
      title: procedure.title,
      stepsLabel,
      hasCaution,
      accessibilityLabel: `${procedure.title}, ${stepsLabel}${
        hasCaution ? ', has safety notes' : ''
      }`,
    };
  });
}
