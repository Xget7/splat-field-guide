import type { Pack, ProcedureId } from '../../pack/pack';

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
