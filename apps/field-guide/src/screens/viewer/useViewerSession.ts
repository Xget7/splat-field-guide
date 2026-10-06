import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ProcedureId } from '../../features/pack/pack';
import {
  SessionEventType,
  type SessionEvent,
} from '../../features/guide/session';
import type { ReadyGuide } from '../../features/pack/catalog';
import { sessionForExchange } from '../../features/instructor/turn';
import type { ModelInstructor } from '../../features/instructor/models/modelInstructor';
import {
  useInstructorVoice,
  type Utterance,
} from '../../features/instructor/voice/useInstructorVoice';
import { clearProgress, saveProgress } from '../../app/progressStorage';
import { cardContentFor } from './guideContent';
import {
  answeredExchanges,
  initialViewerState,
  ExchangePhase,
  reduceViewer,
  ViewerActionType,
  type ViewerAction,
  type ViewerState,
} from './viewerState';

const PROGRESS_FAILURE = 'Field guide: progress not saved';

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
  // Repeat needs a new utterance id so the same step is spoken again.
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

  // Preserve continuation while exploring, and clear it on Stop or Finish.
  const progressSession =
    state.session.procedureId === null ? state.resume : state.session;
  const progressProcedure = progressSession?.procedureId ?? null;
  const progressStep = progressSession?.stepIndex ?? 0;
  useEffect(() => {
    // The first step needs no saved continuation because a fresh start already opens it.
    const saved =
      progressProcedure === null || progressStep === 0
        ? clearProgress()
        : saveProgress({
            guideId: guide.id,
            procedureId: progressProcedure,
            stepIndex: progressStep,
          });
    saved.catch(failure => console.warn(PROGRESS_FAILURE, failure));
  }, [guide.id, progressProcedure, progressStep]);

  const stopVoice = voice.stop;
  const finish = useCallback(() => {
    stopVoice();
    dispatch({ type: SessionEventType.end });
    return clearProgress().catch(failure =>
      console.warn(PROGRESS_FAILURE, failure),
    );
  }, [dispatch, stopVoice]);

  return {
    session,
    exploring: session.procedureId === null,
    canResume: state.resume !== null,
    explore,
    resumeGuide,
    finish,
    frameRequest,
    card,
    thread,
    exchange,
    voice,
    ask,
    dispatch,
  };
}
