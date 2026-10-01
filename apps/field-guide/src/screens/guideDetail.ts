import type { Pack, ProcedureId } from '../domain/pack';
import { LearnMode } from '../navigation/routes';
import { IconName } from '../ui/kit/Icon';
import { twoDigits } from '../ui/readout';

export const MODE_OPTIONS = [
  {
    mode: LearnMode.instructor,
    title: 'Instructor',
    icon: IconName.mic,
    testID: 'mode-instructor',
    description: 'Ask about a part. It shows you where.',
  },
  {
    mode: LearnMode.selfGuided,
    title: 'Self-guided',
    icon: IconName.list,
    testID: 'mode-self-guided',
    description: 'Read each step at your own pace.',
  },
] as const;

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
