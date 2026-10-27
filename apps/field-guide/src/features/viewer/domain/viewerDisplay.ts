import {
  cardContentFor,
  cardPartFor,
  partTrailFor,
  stepRowsFor,
  type CardContent,
  type SessionState,
  type StepRow,
} from '../../guide';
import {
  ExchangePhase,
  sessionForExchange,
  stepKeyFor,
  utteranceId,
  UtteranceKind,
  type Utterance,
  type VoiceContext,
} from '../../instructor';
import type { Pack, Part } from '../../pack/pack';
import { answeredExchanges, type ViewerState } from './viewerState';

/** What the viewer shows for its state, derived once per state so screens can compare identities. */
export interface ViewerDisplay {
  /** The session on screen, which a streaming answer can move to its part. */
  readonly session: SessionState;
  readonly exploring: boolean;
  readonly canResume: boolean;
  readonly card: CardContent;
  readonly steps: readonly StepRow[];
  readonly trail: readonly Part[];
  readonly cardPart: Part | null;
  /** Text the drawer and part card already show, so an answer need not repeat it. */
  readonly shownText: readonly string[];
  readonly utterance: Utterance | null;
  readonly voiceContext: VoiceContext;
}

/** The display before this state, whose values are kept while their inputs are unchanged. */
export interface DisplayedState {
  readonly viewer: ViewerState;
  readonly display: ViewerDisplay;
}

export function displayFor(
  viewer: ViewerState,
  pack: Pack,
  previous: DisplayedState | null,
): ViewerDisplay {
  const before = previous?.display;
  const { exchange, frameRequest } = viewer;
  const sameSource =
    previous !== null &&
    previous.viewer.session === viewer.session &&
    previous.viewer.exchange === exchange;
  const session =
    sameSource && before !== undefined
      ? before.session
      : sessionForExchange(viewer.session, exchange, pack);
  const sameSession = before?.session === session;
  const card =
    sameSession && before ? before.card : cardContentFor(session, pack);
  const cardPart =
    sameSession && before ? before.cardPart : cardPartFor(session, pack);
  const shownText =
    before?.card === card && before.cardPart === cardPart
      ? before.shownText
      : [card.title, card.body, card.caution, cardPart?.summary ?? ''];
  const sameUtterance =
    before !== undefined &&
    previous?.viewer.exchange === exchange &&
    previous.viewer.frameRequest === frameRequest &&
    sameSession;
  return {
    session,
    exploring: session.procedureId === null,
    canResume: viewer.resume !== null,
    card,
    steps: sameSession && before ? before.steps : stepRowsFor(session, pack),
    trail: sameSession && before ? before.trail : partTrailFor(session, pack),
    cardPart,
    shownText,
    utterance:
      sameUtterance && before
        ? before.utterance
        : utteranceFor(viewer, session, card),
    voiceContext: voiceContextFor(viewer, pack),
  };
}

// Repeat needs a new utterance id so the same step is spoken again.
function utteranceFor(
  { exchange, frameRequest }: ViewerState,
  session: SessionState,
  card: CardContent,
): Utterance | null {
  if (exchange !== null) {
    return exchange.phase === ExchangePhase.done
      ? {
          kind: UtteranceKind.answer,
          stepKey: null,
          id: utteranceId(UtteranceKind.answer, exchange.id),
          reply: exchange.reply,
          caution: exchange.caution,
        }
      : null;
  }
  if (card.stepCount === 0 && !card.selected) {
    return null;
  }
  return {
    kind: UtteranceKind.step,
    stepKey: stepKeyFor(session),
    id: utteranceId(
      UtteranceKind.step,
      `${stepKeyFor(session)}:${frameRequest}`,
    ),
    reply: card.body,
    caution: card.caution,
  };
}

function voiceContextFor(viewer: ViewerState, pack: Pack): VoiceContext {
  const { exchange } = viewer;
  return {
    pack,
    state: viewer.session,
    history: answeredExchanges(viewer),
    thinking:
      exchange?.phase === ExchangePhase.pending ||
      exchange?.phase === ExchangePhase.streaming,
    pendingQuestion:
      exchange?.phase === ExchangePhase.pending ? exchange.question : null,
  };
}
