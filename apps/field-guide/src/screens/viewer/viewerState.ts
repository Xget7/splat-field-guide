import type { Pack, ProcedureId } from '../../domain/pack';
import {
  reduce,
  SessionEventType,
  startAt,
  type SessionEvent,
  type SessionState,
} from '../../domain/session';
import { answerFor } from '../../instructor/instructor';

/** The last question and what the instructor said back. */
export interface Exchange {
  readonly question: string;
  readonly reply: string;
  readonly caution: string;
}

export interface ViewerState {
  readonly session: SessionState;
  /** Cleared by anything but a question, so it never describes a step that has moved on. */
  readonly exchange: Exchange | null;
  /** Bumped to frame the step again even when the session itself did not change. */
  readonly frameRequest: number;
}

export const ViewerActionType = {
  session: 'session',
  ask: 'ask',
} as const;
export type ViewerActionType =
  (typeof ViewerActionType)[keyof typeof ViewerActionType];

export type ViewerAction =
  | {
      readonly type: typeof ViewerActionType.session;
      readonly event: SessionEvent;
    }
  | { readonly type: typeof ViewerActionType.ask; readonly question: string };

export function initialViewerState(
  procedureId: ProcedureId,
  stepIndex: number,
  pack: Pack,
): ViewerState {
  return {
    session: startAt(procedureId, stepIndex, pack),
    exchange: null,
    frameRequest: 0,
  };
}

function apply(
  state: ViewerState,
  event: SessionEvent,
  pack: Pack,
  exchange: Exchange | null,
): ViewerState {
  return {
    session: reduce(state.session, event, pack),
    exchange,
    // Repeat means "show me again", which the user wants after orbiting away.
    frameRequest:
      event.type === SessionEventType.repeat
        ? state.frameRequest + 1
        : state.frameRequest,
  };
}

export function reduceViewer(
  state: ViewerState,
  action: ViewerAction,
  pack: Pack,
): ViewerState {
  switch (action.type) {
    case ViewerActionType.session: {
      const next = apply(state, action.event, pack, null);
      return next.session === state.session &&
        next.frameRequest === state.frameRequest &&
        state.exchange === null
        ? state
        : next;
    }
    case ViewerActionType.ask: {
      const question = action.question.trim();
      if (question === '') {
        return state;
      }
      const answer = answerFor(question, state.session, pack);
      const exchange = {
        question,
        reply: answer.reply,
        caution: answer.caution,
      };
      return answer.event === null
        ? { ...state, exchange }
        : apply(state, answer.event, pack, exchange);
    }
  }
}
