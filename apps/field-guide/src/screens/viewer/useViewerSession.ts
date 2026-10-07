import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ProcedureId } from '../../features/pack/pack';
import {
  SessionEventType,
  type SessionEvent,
} from '../../features/guide/session';
import type { ReadyGuide } from '../../features/pack/catalog';
import { sessionForExchange } from '../../features/instructor/turn';
import type { InstructorRuntime } from '../../app/instructorRuntime';
import { stepKeyFor } from '../../features/instructor/voice/voiceSession';
import {
  UtteranceKind,
  utteranceId,
  type VoiceContext,
} from '../../features/instructor/voice/voiceSession';
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
  runtime: InstructorRuntime;
  startInVoice?: boolean;
}

/** Coordinates the session, instructor, speech and saved progress independently of layout. */
export function useViewerSession({
  guide,
  procedureId,
  stepIndex,
  instructorOpen,
  runtime,
  startInVoice,
}: Options) {
  const { pack } = guide;
  const { instructor } = runtime;
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
  const askVoice = useRef<((text: string) => boolean) | null>(null);
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
      if (askVoice.current?.(question)) {
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
  }, [exchange, card, session, frameRequest]);

  const context = useMemo(
    (): VoiceContext => ({
      pack,
      state: state.session,
      history: answeredExchanges(state),
      thinking,
      pendingQuestion:
        exchange?.phase === ExchangePhase.pending ? exchange.question : null,
    }),
    [pack, state, thinking, exchange],
  );
  const voice = useInstructorVoice({
    pack,
    enabled: instructorOpen,
    utterance,
    context,
    runtime,
    onTurn: event => act({ type: ViewerActionType.turn, event }),
    onAction: event => act({ type: ViewerActionType.agent, event }),
    onIdle: idle => runtime.setIdle(idle),
    onAsk: ask,
    onCancel: cancelAnswer,
    startInVoice,
  });
  interruptVoice.current = voice.interrupt;
  askVoice.current = voice.ask;

  useEffect(() => {
    runtime.setPack(pack);
  }, [runtime, pack]);
  useEffect(() => {
    runtime.setInstructorOpen(instructorOpen);
    return () => runtime.setInstructorOpen(false);
  }, [runtime, instructorOpen]);

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
