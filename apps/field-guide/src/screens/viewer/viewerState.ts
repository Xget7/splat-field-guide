import type { Pack, PartId, ProcedureId } from '../../domain/pack';
import {
  reduce,
  SessionEventType,
  startAt,
  type SessionEvent,
  type SessionState,
} from '../../domain/session';
import { answerFor, type InstructorAnswer } from '../../instructor/instructor';
import type { PartialAnswer } from '../../instructor/onDevice';

export const ExchangePhase = {
  pending: 'pending',
  streaming: 'streaming',
  done: 'done',
} as const;
export type ExchangePhase = (typeof ExchangePhase)[keyof typeof ExchangePhase];

/** The last question and what the instructor said back. */
export interface Exchange {
  readonly question: string;
  readonly reply: string;
  readonly caution: string;
  readonly id: number;
  readonly phase: ExchangePhase;
  readonly part: PartId | null;
}

export interface ViewerState {
  readonly session: SessionState;
  /** Cleared by anything but a question, so it never describes a step that has moved on. */
  readonly exchange: Exchange | null;
  /** Bumped to frame the step again even when the session itself did not change. */
  readonly frameRequest: number;
  /** Streaming selection is provisional until the final answer is accepted. */
  readonly answerSession: SessionState | null;
}

export const ViewerActionType = {
  session: 'session',
  ask: 'ask',
  begin: 'begin',
  partial: 'partial',
  answer: 'answer',
  cancel: 'cancel',
  framePart: 'framePart',
} as const;
export type ViewerActionType =
  (typeof ViewerActionType)[keyof typeof ViewerActionType];

export type ViewerAction =
  | {
      readonly type: typeof ViewerActionType.session;
      readonly event: SessionEvent;
    }
  | {
      readonly type: typeof ViewerActionType.ask;
      readonly question: string;
      readonly id: number;
    }
  | {
      readonly type: typeof ViewerActionType.begin;
      readonly question: string;
      readonly id: number;
    }
  | {
      readonly type: typeof ViewerActionType.partial;
      readonly partial: PartialAnswer;
      readonly id: number;
    }
  | {
      readonly type: typeof ViewerActionType.answer;
      readonly answer: InstructorAnswer;
      readonly id: number;
    }
  | { readonly type: typeof ViewerActionType.cancel }
  | {
      readonly type: typeof ViewerActionType.framePart;
      readonly partId: PartId;
    };

export function initialViewerState(
  procedureId: ProcedureId,
  stepIndex: number,
  pack: Pack,
): ViewerState {
  return {
    session: startAt(procedureId, stepIndex, pack),
    exchange: null,
    frameRequest: 0,
    answerSession: null,
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
    answerSession: null,
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
    case ViewerActionType.cancel:
      return state.exchange === null ||
        state.exchange.phase === ExchangePhase.done
        ? state
        : {
            ...state,
            session: state.answerSession ?? state.session,
            exchange: null,
            answerSession: null,
          };
    case ViewerActionType.framePart:
      return {
        ...state,
        session: reduce(
          state.session,
          { type: SessionEventType.select, partId: action.partId },
          pack,
        ),
        frameRequest: state.frameRequest + 1,
      };
    case ViewerActionType.begin: {
      const question = action.question.trim();
      return question === ''
        ? state
        : {
            ...state,
            answerSession: state.session,
            exchange: {
              id: action.id,
              phase: ExchangePhase.pending,
              question,
              reply: '',
              caution: '',
              part: null,
            },
          };
    }
    case ViewerActionType.partial: {
      if (
        state.exchange?.id !== action.id ||
        state.exchange.phase === ExchangePhase.done
      ) {
        return state;
      }
      const exchange: Exchange = {
        ...state.exchange,
        phase: ExchangePhase.streaming,
        reply: action.partial.reply,
        part: action.partial.part,
      };
      return action.partial.part === null
        ? { ...state, exchange }
        : {
            ...apply(
              state,
              { type: SessionEventType.select, partId: action.partial.part },
              pack,
              exchange,
            ),
            answerSession: state.answerSession,
          };
    }
    case ViewerActionType.answer: {
      if (
        state.exchange?.id !== action.id ||
        state.exchange.phase === ExchangePhase.done
      ) {
        return state;
      }
      const { answer } = action;
      const base = {
        ...state,
        session: state.answerSession ?? state.session,
        answerSession: null,
      };
      const next =
        answer.event === null
          ? base
          : apply(base, answer.event, pack, state.exchange);
      return {
        ...next,
        exchange: {
          ...state.exchange,
          phase: ExchangePhase.done,
          reply: answer.reply,
          caution: answer.caution,
          part: answer.part,
        },
      };
    }
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
      const exchange: Exchange = {
        question,
        reply: answer.reply,
        caution: answer.caution,
        id: action.id,
        phase: ExchangePhase.done,
        part: answer.part,
      };
      return answer.event === null
        ? { ...state, exchange, answerSession: null }
        : apply(state, answer.event, pack, exchange);
    }
  }
}
