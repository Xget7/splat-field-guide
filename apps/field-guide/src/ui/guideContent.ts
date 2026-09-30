import { findPart, type Pack, type PartId } from '../domain/pack';
import {
  currentProcedure,
  currentStep,
  isLastStep,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../domain/session';
import { TOUR_ID } from '../domain/tour';

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
  readonly nextLabel: string;
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
  return {
    kind: part
      ? CardKind.part
      : procedure
      ? CardKind.procedure
      : CardKind.overview,
    title: part?.name ?? procedure?.title ?? pack.title,
    body: part?.summary ?? step?.text ?? 'Tap a part to learn about it.',
    caution: step?.caution ?? '',
    stepNumber: step ? state.stepIndex + 1 : 0,
    stepCount: procedure?.steps.length ?? 0,
    selected: selected !== undefined,
    backDisabled: !step || state.stepIndex === 0,
    nextDisabled: !step,
    nextLabel: isLastStep(state, pack) ? 'Start over' : 'Next',
  };
}

export function nextEventFor(state: SessionState, pack: Pack): SessionEvent {
  return isLastStep(state, pack) && state.procedureId !== null
    ? { type: SessionEventType.start, procedureId: state.procedureId }
    : { type: SessionEventType.next };
}

/** Unknown labels leave the current selection alone; zero clears it. */
export function partIdForLabel(
  label: number,
  pack: Pack,
): PartId | null | undefined {
  return label === 0 ? null : pack.parts.find(part => part.label === label)?.id;
}
