import type { Pack, ProcedureId } from '../../features/pack/pack';
import {
  INITIAL_SESSION,
  reduce,
  SessionEventType,
  startAt,
  type SessionEvent,
  type SessionState,
} from '../../features/guide/session';
import {
  ExchangePhase,
  TurnEventType,
  type Exchange,
  type TurnEvent,
} from '../../features/instructor/turn';
import { CardKind, cardContentFor, type CardContent } from './guideContent';

export { ExchangePhase, type Exchange } from '../../features/instructor/turn';

export const MAX_THREAD_ENTRIES = 60;

export const EntryKind = { step: 'step', exchange: 'exchange' } as const;
export type EntryKind = (typeof EntryKind)[keyof typeof EntryKind];

/** Keep steps and answered questions in chronological order. */
export type ThreadEntry =
  | {
      readonly kind: typeof EntryKind.step;
      readonly id: number;
      /** Deduplicate consecutive entries for the same step and part. */
      readonly key: string;
      readonly card: CardContent;
    }
  | { readonly kind: typeof EntryKind.exchange; readonly exchange: Exchange };

export interface ViewerState {
  readonly session: SessionState;
  /** Cleared by anything but a question, so it never describes a step that has moved on. */
  readonly exchange: Exchange | null;
  /** Exclude the live exchange; without one, the last entry is the step on screen. */
  readonly thread: readonly ThreadEntry[];
  readonly stepsShown: number;
  /** Bumped to frame the step again even when the session itself did not change. */
  readonly frameRequest: number;
  readonly resume: SessionState | null;
}

export const ViewerActionType = {
  session: 'session',
  turn: 'turn',
  explore: 'explore',
  guide: 'guide',
} as const;

export type ViewerAction =
  | {
      readonly type: typeof ViewerActionType.session;
      readonly event: SessionEvent;
    }
  | { readonly type: typeof ViewerActionType.turn; readonly event: TurnEvent }
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
      resume: null,
    },
    pack,
  );
}

const append = (thread: readonly ThreadEntry[], entry: ThreadEntry) =>
  [...thread, entry].slice(-MAX_THREAD_ENTRIES);

const stepKey = (session: SessionState) =>
  `${session.procedureId}:${session.stepIndex}:${session.selectedPart}`;

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

function showStep(state: ViewerState, pack: Pack): ViewerState {
  const key = stepKey(state.session);
  const last = state.thread[state.thread.length - 1];
  if (last?.kind === EntryKind.step && last.key === key) {
    return state;
  }
  // The overview only stands for the screen until a part or step replaces it.
  const replaced =
    last?.kind === EntryKind.step && last.card.kind === CardKind.overview;
  return {
    ...state,
    stepsShown: state.stepsShown + 1,
    thread: append(replaced ? state.thread.slice(0, -1) : state.thread, {
      kind: EntryKind.step,
      id: state.stepsShown,
      key,
      card: cardContentFor(state.session, pack),
    }),
  };
}

/** Return answered exchanges in chronological order for model follow-ups. */
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
    // Starting a procedure while exploring is a new guide; the old one is not resumed.
    resume:
      event.type === SessionEventType.end
        ? null
        : session.procedureId === null
        ? state.resume
        : null,
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
    case ViewerActionType.turn: {
      const event = action.event;
      switch (event.type) {
        case TurnEventType.begin:
          return { ...settle(state), exchange: event.exchange };
        case TurnEventType.partial:
          return { ...state, exchange: event.exchange };
        case TurnEventType.answer:
          return event.answer.event === null
            ? { ...state, exchange: event.exchange }
            : apply(state, event.answer.event, pack, event.exchange);
        case TurnEventType.cancel: {
          const last = state.thread[state.thread.length - 1];
          const restored =
            last?.kind === EntryKind.exchange ? last.exchange : null;
          return {
            ...state,
            exchange: restored,
            thread:
              restored === null ? state.thread : state.thread.slice(0, -1),
          };
        }
      }
      return state;
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
          session: state.resume,
          resume: null,
        },
        pack,
      );
    }
  }
}
