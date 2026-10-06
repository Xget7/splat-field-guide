import { findPart, type Pack } from '../../features/pack/pack';
import {
  currentProcedure,
  currentStep,
  isLastStep,
  type SessionState,
} from '../../features/guide/session';
import { TOUR_ID } from '../../features/guide/tour';

export const CardKind = {
  part: 'part',
  procedure: 'procedure',
  overview: 'overview',
} as const;
export type CardKind = (typeof CardKind)[keyof typeof CardKind];

export interface CardContent {
  readonly kind: CardKind;
  readonly title: string;
  readonly body: string;
  readonly caution: string;
  readonly stepNumber: number;
  readonly stepCount: number;
  readonly selected: boolean;
  readonly backDisabled: boolean;
  readonly nextDisabled: boolean;
  /** The step that ends the procedure: Next becomes Finish. */
  readonly last: boolean;
}

export function cardContentFor(state: SessionState, pack: Pack): CardContent {
  const procedure = currentProcedure(state, pack);
  const step = currentStep(state, pack);
  const selected =
    state.selectedPart === null
      ? undefined
      : findPart(pack, state.selectedPart);
  const tourPart =
    procedure?.id === TOUR_ID && step
      ? findPart(pack, step.parts[0])
      : undefined;
  const part = selected ?? tourPart;
  const stepTitle = step?.parts
    .map(id => findPart(pack, id)?.name)
    .filter(name => name !== undefined)
    .join(', ');
  return {
    kind: part
      ? CardKind.part
      : procedure
      ? CardKind.procedure
      : CardKind.overview,
    title: part?.name ?? (stepTitle || procedure?.title || pack.title),
    body: part?.summary ?? step?.text ?? 'Select a part to inspect it.',
    // A step's caution is about the step, not about a part picked on the side.
    caution: selected ? '' : step?.caution ?? '',
    stepNumber: step ? state.stepIndex + 1 : 0,
    stepCount: procedure?.steps.length ?? 0,
    selected: selected !== undefined,
    backDisabled: !step || state.stepIndex === 0,
    nextDisabled: !step,
    last: isLastStep(state, pack),
  };
}

export interface StepRow {
  readonly id: string;
  readonly text: string;
  /** The rest of the step, shown under the text when it is the current one. */
  readonly detail: string;
  readonly caution: string;
}

const SENTENCE_END = /(?<=[.!?])\s+/;

/** Use part names for tour rows and the first instruction sentence for authored steps. */
export function stepRowsFor(
  state: SessionState,
  pack: Pack,
): readonly StepRow[] {
  const procedure = currentProcedure(state, pack);
  return (procedure?.steps ?? []).map(step => {
    const part =
      procedure?.id === TOUR_ID ? findPart(pack, step.parts[0]) : undefined;
    const [first, ...rest] = step.text.split(SENTENCE_END);
    return {
      id: step.id,
      text: part?.name ?? first,
      detail: part?.summary ?? rest.join(' '),
      caution: step.caution,
    };
  });
}
