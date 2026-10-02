import type { Pack, ProcedureId } from '../../../domain/pack';
import {
  INITIAL_SESSION,
  reduce,
  SessionEventType,
  startAt,
  type SessionEvent,
  type SessionState,
} from '../../../domain/session';
import {
  answerFor,
  type InstructorAnswer,
} from '../../../modules/instructor/domain/instructor';
import type { PartialAnswer } from '../../../modules/instructor/application/modelInstructor';
import { cardContentFor, type CardContent } from './guideContent';

// A long session scrolls back this far; older entries drop off the top.
export const MAX_THREAD_ENTRIES = 60;

export const ExchangePhase = {
  pending: 'pending',
  streaming: 'streaming',
  done: 'done',
} as const;
export type ExchangePhase = (typeof ExchangePhase)[keyof typeof ExchangePhase];

/** A question and what the instructor said back. */
export interface Exchange {
  readonly question: string;
  readonly reply: string;
  readonly caution: string;
  readonly id: number;
  readonly phase: ExchangePhase;
}

export const EntryKind = { step: 'step', exchange: 'exchange' } as const;
export type EntryKind = (typeof EntryKind)[keyof typeof EntryKind];

/** What the conversation shows, oldest first: steps as they were shown, and answered questions. */
export type ThreadEntry =
  | {
      readonly kind: typeof EntryKind.step;
      readonly id: number;
      /** Which step, and which part on it, so the same one is not shown twice in a row. */
      readonly key: string;
      readonly card: CardContent;
    }
  | { readonly kind: typeof EntryKind.exchange; readonly exchange: Exchange };

export interface ViewerState {
  readonly session: SessionState;
  /** Cleared by anything but a question, so it never describes a step that has moved on. */
  readonly exchange: Exchange | null;
  /**
   * Everything said before the live exchange. Without one, the last entry is the step on
   * screen.
   */
  readonly thread: readonly ThreadEntry[];
  /** How many steps the thread has shown, which numbers the next one. */
  readonly stepsShown: number;
  /** Bumped to frame the step again even when the session itself did not change. */
  readonly frameRequest: number;
  /** Streaming selection is provisional until the final answer is accepted. */
  readonly answerSession: SessionState | null;
  /** Where the guide left off while exploring, to pick it up again. */
  readonly resume: SessionState | null;
}

export const ViewerActionType = {
  session: 'session',
  ask: 'ask',
  begin: 'begin',
  partial: 'partial',
  answer: 'answer',
  cancel: 'cancel',
  explore: 'explore',
  guide: 'guide',
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
  | { readonly type: typeof ViewerActionType.explore }
  | { readonly type: typeof ViewerActionType.guide };

export function initialViewerState(
  procedureId: ProcedureId,
  stepIndex: number,
  pack: Pack,
): ViewerState {
  return showStep(
    {
      session: startAt(procedureId, stepIndex, pack),
      exchange: null,
      thread: [],
      stepsShown: 0,
      frameRequest: 0,
      answerSession: null,
      resume: null,
    },
    pack,
  );
}

const append = (thread: readonly ThreadEntry[], entry: ThreadEntry) =>
  [...thread, entry].slice(-MAX_THREAD_ENTRIES);

const stepKey = (session: SessionState) =>
  `${session.procedureId}:${session.stepIndex}:${session.selectedPart}`;

/** An answered question moves up into the thread; one still on its way is dropped. */
function settle(state: ViewerState): ViewerState {
  return state.exchange?.phase === ExchangePhase.done
    ? {
        ...state,
        exchange: null,
        thread: append(state.thread, {
          kind: EntryKind.exchange,
          exchange: state.exchange,
        }),
      }
    : { ...state, exchange: null };
}

/** The step on screen joins the thread, unless it is already the last thing said. */
function showStep(state: ViewerState, pack: Pack): ViewerState {
  const key = stepKey(state.session);
  const last = state.thread[state.thread.length - 1];
  if (last?.kind === EntryKind.step && last.key === key) {
    return state;
  }
  return {
    ...state,
    stepsShown: state.stepsShown + 1,
    thread: append(state.thread, {
      kind: EntryKind.step,
      id: state.stepsShown,
      key,
      card: cardContentFor(state.session, pack),
    }),
  };
}

/** Every answered question so far, oldest first, for a model to read a follow-up by. */
export function answeredExchanges(state: ViewerState): Exchange[] {
  const earlier = state.thread.flatMap(entry =>
    entry.kind === EntryKind.exchange ? [entry.exchange] : [],
  );
  return state.exchange?.phase === ExchangePhase.done
    ? [...earlier, state.exchange]
    : earlier;
}

function apply(
  state: ViewerState,
  event: SessionEvent,
  pack: Pack,
  exchange: Exchange | null,
): ViewerState {
  const session = reduce(state.session, event, pack);
  return {
    ...state,
    session,
    exchange,
    answerSession: null,
    // Starting a procedure while exploring is a new guide; the old one is not resumed.
    resume: session.procedureId === null ? state.resume : null,
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
    case ViewerActionType.cancel: {
      if (
        state.exchange === null ||
        state.exchange.phase === ExchangePhase.done
      ) {
        return state;
      }
      // The answer that was live before this question becomes live again.
      const last = state.thread[state.thread.length - 1];
      const restored = last?.kind === EntryKind.exchange ? last.exchange : null;
      return {
        ...state,
        session: state.answerSession ?? state.session,
        exchange: restored,
        thread: restored === null ? state.thread : state.thread.slice(0, -1),
        answerSession: null,
      };
    }
    case ViewerActionType.begin: {
      const question = action.question.trim();
      return question === ''
        ? state
        : {
            ...settle(state),
            answerSession: state.session,
            exchange: {
              id: action.id,
              phase: ExchangePhase.pending,
              question,
              reply: '',
              caution: '',
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
        },
      };
    }
    case ViewerActionType.session: {
      const next = apply(state, action.event, pack, null);
      return next.session === state.session &&
        next.frameRequest === state.frameRequest &&
        state.exchange === null
        ? state
        : showStep({ ...next, thread: settle(state).thread }, pack);
    }
    case ViewerActionType.explore: {
      if (state.session.procedureId === null) {
        return state;
      }
      // A part picked during the step stays picked: it is what the user went to look at.
      return showStep(
        {
          ...settle(state),
          answerSession: null,
          session: {
            ...INITIAL_SESSION,
            selectedPart: state.session.selectedPart,
          },
          resume: { ...state.session, selectedPart: null },
        },
        pack,
      );
    }
    case ViewerActionType.guide: {
      if (state.resume === null) {
        return state;
      }
      return showStep(
        {
          ...settle(state),
          answerSession: null,
          session: state.resume,
          resume: null,
        },
        pack,
      );
    }
    case ViewerActionType.ask: {
      const question = action.question.trim();
      if (question === '') {
        return state;
      }
      const settled = settle(state);
      const answer = answerFor(question, state.session, pack);
      const exchange: Exchange = {
        question,
        reply: answer.reply,
        caution: answer.caution,
        id: action.id,
        phase: ExchangePhase.done,
      };
      return answer.event === null
        ? { ...settled, exchange, answerSession: null }
        : apply(settled, answer.event, pack, exchange);
    }
  }
}
