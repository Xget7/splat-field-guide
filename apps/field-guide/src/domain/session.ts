import { Pack, PartId, Procedure, ProcedureId, Step } from './pack';
import { findPart, findProcedure } from './pack';

export const SessionEventType = {
  start: 'start',
  next: 'next',
  back: 'back',
  repeat: 'repeat',
  select: 'select',
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
  | { readonly type: typeof SessionEventType.end };

export interface SessionState {
  readonly procedureId: ProcedureId | null;
  readonly stepIndex: number;
  /** Overrides the step's highlight until the step changes. */
  readonly selectedPart: PartId | null;
}

export const INITIAL_SESSION: SessionState = {
  procedureId: null,
  stepIndex: 0,
  selectedPart: null,
};

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

/**
 * Invalid events (an unknown id, next with no procedure) return the same
 * state object. Next on the last step and back on the first stay put, so the
 * player can show "done" without the session ending behind its back.
 */
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
        ? { ...state, stepIndex: state.stepIndex + 1, selectedPart: null }
        : state;
    case SessionEventType.back:
      return procedure && state.stepIndex > 0
        ? { ...state, stepIndex: state.stepIndex - 1, selectedPart: null }
        : state;
    case SessionEventType.repeat:
      // Repeating re-presents the step's own parts, dropping any override.
      return procedure && state.selectedPart !== null
        ? { ...state, selectedPart: null }
        : state;
    case SessionEventType.select:
      if (event.partId !== null && !findPart(pack, event.partId)) {
        return state;
      }
      return state.selectedPart === event.partId
        ? state
        : { ...state, selectedPart: event.partId };
    case SessionEventType.end:
      return INITIAL_SESSION;
  }
}
