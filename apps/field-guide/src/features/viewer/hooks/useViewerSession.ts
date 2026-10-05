import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { highlightFor } from '../../../domain/derive';
import type { ProcedureId } from '../../../domain/pack';
import type { SessionEvent } from '../../../domain/session';
import type { ReadyGuide } from '../../../modules/catalog/catalog';
import { sessionForExchange } from '../../../modules/instructor/domain/turn';
import type { ModelInstructor } from '../../../modules/instructor/application/modelInstructor';
import {
  useInstructorVoice,
  type Utterance,
} from '../../../modules/instructor/voice/hooks/useInstructorVoice';
import {
  clearProgress,
  saveProgress,
} from '../../../modules/progress/data/progressStorage';
import { cardContentFor, markedPartsFor } from '../model/guideContent';
import {
  answeredExchanges,
  initialViewerState,
  ExchangePhase,
  reduceViewer,
  ViewerActionType,
  type ViewerAction,
  type ViewerState,
} from '../model/viewerState';

interface Options {
  guide: ReadyGuide;
  procedureId: ProcedureId;
  stepIndex: number;
  instructorOpen: boolean;
  instructor: ModelInstructor;
  startInVoice?: boolean;
}

/** Coordinates the session, instructor, speech and saved progress independently of layout. */
export function useViewerSession({
  guide,
  procedureId,
  stepIndex,
  instructorOpen,
  instructor,
  startInVoice,
}: Options) {
  const { pack } = guide;
  const [state, act] = useReducer(
    (current: ViewerState, action: ViewerAction) =>
      reduceViewer(current, action, pack),
    null,
    () => initialViewerState(procedureId, stepIndex, pack),
  );
  const { exchange, thread, frameRequest } = state;
  const session = useMemo(
    () => sessionForExchange(state.session, exchange, pack),
    [state.session, exchange, pack],
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const interruptVoice = useRef<(() => void) | null>(null);

  const highlight = useMemo(
    () => [...highlightFor(session, pack)],
    [session, pack],
  );
  const marked = useMemo(() => markedPartsFor(session, pack), [session, pack]);
  const card = useMemo(() => cardContentFor(session, pack), [session, pack]);
  const cancelAnswer = useCallback(() => instructor.cancel(), [instructor]);
  const dispatch = useCallback(
    (event: SessionEvent) => {
      cancelAnswer();
      interruptVoice.current?.();
      act({ type: ViewerActionType.session, event });
    },
    [cancelAnswer],
  );
  /** Leaves the guide's flow to look around, and comes back to it. */
  const changeMode = useCallback(
    (type: typeof ViewerActionType.explore | typeof ViewerActionType.guide) => {
      cancelAnswer();
      interruptVoice.current?.();
      act({ type });
    },
    [cancelAnswer],
  );
  const explore = useCallback(
    () => changeMode(ViewerActionType.explore),
    [changeMode],
  );
  const resumeGuide = useCallback(
    () => changeMode(ViewerActionType.guide),
    [changeMode],
  );
  const ask = useCallback(
    (text: string) => {
      const question = text.trim();
      if (question === '') {
        return;
      }
      interruptVoice.current?.();
      const current = stateRef.current;
      instructor.ask(
        {
          question,
          state: current.session,
          pack,
          history: answeredExchanges(current),
        },
        event => act({ type: ViewerActionType.turn, event }),
      );
    },
    [pack, instructor],
  );

  const thinking =
    exchange?.phase === ExchangePhase.pending ||
    exchange?.phase === ExchangePhase.streaming;
  // The instructor reads each step or part it shows, not only its answers, so the tour
  // and the step buttons talk. Repeat asks for the same step again.
  const utterance = useMemo((): Utterance | null => {
    if (exchange !== null) {
      return exchange.phase === ExchangePhase.done
        ? {
            id: `answer:${exchange.id}`,
            reply: exchange.reply,
            caution: exchange.caution,
          }
        : null;
    }
    if (card.stepCount === 0 && !card.selected) {
      return null;
    }
    return {
      id: `step:${session.procedureId}:${session.stepIndex}:${session.selectedPart}:${frameRequest}`,
      reply: card.body,
      caution: card.caution,
    };
  }, [exchange, card, session, frameRequest]);

  const voice = useInstructorVoice({
    pack,
    enabled: instructorOpen,
    utterance,
    thinking,
    onAsk: ask,
    onCancel: cancelAnswer,
    startInVoice,
  });
  interruptVoice.current = voice.interrupt;

  useEffect(() => {
    if (instructorOpen) {
      instructor.prewarm(pack);
    }
  }, [instructorOpen, pack, instructor]);

  useEffect(() => () => cancelAnswer(), [cancelAnswer, pack]);

  useEffect(() => {
    // The library offers to continue where this leaves off, once there is something to
    // continue: the first step is where a fresh start lands anyway.
    if (session.procedureId === null) {
      // Exploring sets the guide aside; where it left off is still the place to continue.
      return;
    }
    const saved =
      session.stepIndex === 0
        ? clearProgress()
        : saveProgress({
            guideId: guide.id,
            procedureId: session.procedureId,
            stepIndex: session.stepIndex,
          });
    saved.catch(failure =>
      console.warn('Field guide: progress not saved', failure),
    );
  }, [guide.id, session.procedureId, session.stepIndex]);

  return {
    session,
    exploring: session.procedureId === null,
    canResume: state.resume !== null,
    explore,
    resumeGuide,
    frameRequest,
    highlight,
    marked,
    card,
    thread,
    exchange,
    voice,
    ask,
    dispatch,
  };
}
