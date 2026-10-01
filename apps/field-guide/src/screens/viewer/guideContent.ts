import { findPart, type Pack, type PartId } from '../../domain/pack';
import {
  currentProcedure,
  currentStep,
  isLastStep,
  type SessionState,
} from '../../domain/session';
import { TOUR_ID } from '../../domain/tour';
import type { MarkedPart } from './PartMarkers';

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
    body: part?.summary ?? step?.text ?? 'Tap a part to learn about it.',
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

/** Unknown labels leave the current selection alone; zero clears it. */
export function partIdForLabel(
  label: number,
  pack: Pack,
): PartId | null | undefined {
  return label === 0 ? null : pack.parts.find(part => part.label === label)?.id;
}

/** The parts the screen points at: the selection, else the step's own (not those inside). */
export function markedPartsFor(
  state: SessionState,
  pack: Pack,
): readonly MarkedPart[] {
  const ids =
    state.selectedPart !== null
      ? [state.selectedPart]
      : currentStep(state, pack)?.parts ?? [];
  return ids
    .map(id => findPart(pack, id))
    .filter(part => part !== undefined)
    .map(({ id, name, bounds }) => ({ id, name, bounds }));
}
