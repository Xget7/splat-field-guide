import type { Pack, ProcedureId } from '../../../domain/pack';
import { TOUR_ID } from '../../../domain/tour';

export interface ProcedureRow {
  readonly id: ProcedureId;
  readonly title: string;
  readonly stepsLabel: string;
  readonly hasCaution: boolean;
  readonly accessibilityLabel: string;
}

export function procedureRowsFor(pack: Pack): ProcedureRow[] {
  return pack.procedures.map(procedure => {
    const count = procedure.steps.length;
    const stepsLabel = `${count} ${count === 1 ? 'step' : 'steps'}`;
    const hasCaution = procedure.steps.some(
      step => step.caution.trim().length > 0,
    );
    return {
      id: procedure.id,
      title: procedure.title,
      stepsLabel,
      hasCaution,
      accessibilityLabel: `${procedure.title}, ${stepsLabel}${
        hasCaution ? ', has safety notes' : ''
      }`,
    };
  });
}

/** The authored procedures alone: the parts tour has a button of its own. */
export function checkRowsFor(pack: Pack): ProcedureRow[] {
  return procedureRowsFor({
    ...pack,
    procedures: pack.procedures.filter(procedure => procedure.id !== TOUR_ID),
  });
}
