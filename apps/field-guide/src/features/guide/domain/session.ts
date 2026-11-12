import { Pack, PartId, Procedure, ProcedureId, Step } from '../../pack/pack';
import { findPart, findProcedure } from '../../pack/pack';

export const SessionEventType = {
  start: 'start',
  next: 'next',
  back: 'back',
  repeat: 'repeat',
  select: 'select',
  selectParts: 'selectParts',
  goTo: 'goTo',
  end: 'end',
} as const;
export type SessionEventType =
  (typeof SessionEventType)[keyof typeof SessionEventType];

export type SessionEvent =
  | {
      readonly type: typeof SessionEventType.start;
      readonly procedureId: ProcedureId;
    }
  | { readonly type: typeof SessionEventType.next }
  | { readonly type: typeof SessionEventType.back }
  | { readonly type: typeof SessionEventType.repeat }
  | {
      readonly type: typeof SessionEventType.select;
      readonly partId: PartId | null;
    }
  | {
      readonly type: typeof SessionEventType.selectParts;
      readonly partIds: readonly PartId[];
    }
  | { readonly type: typeof SessionEventType.goTo; readonly stepIndex: number }
  | { readonly type: typeof SessionEventType.end };

export interface SessionState {
  readonly procedureId: ProcedureId | null;
  readonly stepIndex: number;
  /** Overrides the step's highlight until the step changes. */
  readonly selectedPart: PartId | null;
  /** An explicit group inspection; a pick or step change replaces it. */
  readonly selectedParts?: readonly PartId[];
}

export const INITIAL_SESSION: SessionState = {
  procedureId: null,
  stepIndex: 0,
  selectedPart: null,
};

function singleSelection(
  state: SessionState,
  partId: PartId | null,
): SessionState {
  const next = { ...state, selectedPart: partId };
  delete next.selectedParts;
  return next;
}

export function currentProcedure(
  state: SessionState,
  pack: Pack,
): Procedure | undefined {
  return state.procedureId === null
    ? undefined
    : findProcedure(pack, state.procedureId);
}

export function currentStep(state: SessionState, pack: Pack): Step | undefined {
  return currentProcedure(state, pack)?.steps[state.stepIndex];
}

export function isLastStep(state: SessionState, pack: Pack): boolean {
  const procedure = currentProcedure(state, pack);
  return !!procedure && state.stepIndex === procedure.steps.length - 1;
}

/** Invalid events preserve object identity, and boundary steps stay active until explicitly ended. */
export function reduce(
  state: SessionState,
  event: SessionEvent,
  pack: Pack,
): SessionState {
  const procedure = currentProcedure(state, pack);
  switch (event.type) {
    case SessionEventType.start:
      return findProcedure(pack, event.procedureId)
        ? { procedureId: event.procedureId, stepIndex: 0, selectedPart: null }
        : state;
    case SessionEventType.next:
      return procedure && state.stepIndex < procedure.steps.length - 1
        ? { ...singleSelection(state, null), stepIndex: state.stepIndex + 1 }
        : state;
    case SessionEventType.back:
      return procedure && state.stepIndex > 0
        ? { ...singleSelection(state, null), stepIndex: state.stepIndex - 1 }
        : state;
    case SessionEventType.repeat:
      return procedure && (state.selectedPart !== null || state.selectedParts)
        ? singleSelection(state, null)
        : state;
    case SessionEventType.select:
      if (event.partId !== null && !findPart(pack, event.partId)) {
        return state;
      }
      return state.selectedPart === event.partId && !state.selectedParts
        ? state
        : singleSelection(state, event.partId);
    case SessionEventType.selectParts: {
      if (event.partIds.some(id => !findPart(pack, id))) return state;
      const ids = [...new Set(event.partIds)].sort();
      if (ids.length < 2) {
        return reduce(
          state,
          { type: SessionEventType.select, partId: ids[0] ?? null },
          pack,
        );
      }
      if (
        ids.length === state.selectedParts?.length &&
        ids.every((id, i) => id === state.selectedParts?.[i])
      )
        return state;
      return { ...state, selectedPart: null, selectedParts: ids };
    }
    case SessionEventType.goTo:
      return procedure &&
        Number.isInteger(event.stepIndex) &&
        event.stepIndex >= 0 &&
        event.stepIndex < procedure.steps.length &&
        event.stepIndex !== state.stepIndex
        ? { ...singleSelection(state, null), stepIndex: event.stepIndex }
        : state;
    case SessionEventType.end:
      return INITIAL_SESSION;
  }
}

/** A procedure moved on to `stepIndex`, or to its last step when it has fewer. */
export function startAt(
  procedureId: ProcedureId,
  stepIndex: number,
  pack: Pack,
): SessionState {
  let state = reduce(
    INITIAL_SESSION,
    { type: SessionEventType.start, procedureId },
    pack,
  );
  for (let step = 0; step < stepIndex; step++) {
    const next = reduce(state, { type: SessionEventType.next }, pack);
    if (next === state) {
      break;
    }
    state = next;
  }
  return state;
}
