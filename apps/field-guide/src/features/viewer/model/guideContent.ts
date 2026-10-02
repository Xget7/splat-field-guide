import { findPart, type Pack, type PartId } from '../../../domain/pack';
import {
  currentProcedure,
  currentStep,
  isLastStep,
  type SessionState,
} from '../../../domain/session';
import { TOUR_ID } from '../../../domain/tour';
import type { MarkedPart } from '../components/PartMarkers';

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

/** A step as the step list names it. */
export interface StepRow {
  readonly id: string;
  readonly text: string;
  /** The rest of the step, shown under the text when it is the current one. */
  readonly detail: string;
  readonly caution: string;
}

// The end of a step's first sentence: a stop, then a space before the next.
const SENTENCE_END = /(?<=[.!?])\s+/;

/**
 * The current procedure's steps, as a list to scan: a tour step is named by its part and
 * explained by its summary, the rest by the first sentence of what to do, then the others.
 */
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

/**
 * Questions worth asking about what is on screen, offered before anything has been asked:
 * about the part a step works on and why the step matters, or how a toured part works.
 */
export function suggestionsFor(
  state: SessionState,
  pack: Pack,
): readonly string[] {
  const procedure = currentProcedure(state, pack);
  const step = currentStep(state, pack);
  const partId = state.selectedPart ?? step?.parts[0];
  const part = partId === undefined ? undefined : findPart(pack, partId);
  if (part === undefined) {
    return [];
  }
  const name = part.name.toLowerCase();
  return procedure?.id === TOUR_ID || state.selectedPart !== null
    ? [`How does the ${name} work?`, 'What can go wrong with it?']
    : [`What does the ${name} do?`, 'Why does this step matter?'];
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
