import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { highlightFor } from '../../../domain/derive';
import type { ProcedureId } from '../../../domain/pack';
import type { SessionEvent } from '../../../domain/session';
import type { ReadyGuide } from '../../../modules/catalog/catalog';
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
  const { session, exchange, thread, frameRequest } = state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const answerGeneration = useRef(0);
  const modelRequest = useRef<number | null>(null);
  const interruptVoice = useRef<(() => void) | null>(null);

  const highlight = useMemo(
    () => [...highlightFor(session, pack)],
    [session, pack],
  );
  const marked = useMemo(() => markedPartsFor(session, pack), [session, pack]);
  const card = useMemo(() => cardContentFor(session, pack), [session, pack]);
  const invalidateAnswer = useCallback(() => {
    answerGeneration.current += 1;
    if (modelRequest.current !== null) {
      modelRequest.current = null;
      instructor.cancelInstructor();
    }
  }, [instructor]);
  const cancelAnswer = useCallback(() => {
    invalidateAnswer();
    act({ type: ViewerActionType.cancel });
  }, [invalidateAnswer]);
  const dispatch = useCallback(
    (event: SessionEvent) => {
      invalidateAnswer();
      interruptVoice.current?.();
      act({ type: ViewerActionType.session, event });
    },
    [invalidateAnswer],
  );
  const ask = useCallback(
    (text: string) => {
      const question = text.trim();
      if (question === '') {
        return;
      }
      invalidateAnswer();
      interruptVoice.current?.();
      const id = answerGeneration.current;
      const current = stateRef.current;
      if (!instructor.usesModel(question, pack)) {
        act({ type: ViewerActionType.ask, question, id });
        return;
      }
      modelRequest.current = id;
      act({ type: ViewerActionType.begin, question, id });
      instructor
        .modelAnswer(
          question,
          current.session,
          pack,
          answeredExchanges(current),
          partial => {
            if (id === answerGeneration.current) {
              act({ type: ViewerActionType.partial, id, partial });
            }
          },
        )
        .then(answer => {
          if (id === answerGeneration.current) {
            modelRequest.current = null;
            act({ type: ViewerActionType.answer, id, answer });
          }
        });
    },
    [pack, invalidateAnswer, instructor],
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
      instructor.prewarmInstructor(pack);
    }
  }, [instructorOpen, pack, instructor]);

  useEffect(() => () => invalidateAnswer(), [invalidateAnswer, pack]);

  useEffect(() => {
    // The library offers to continue where this leaves off, once there is something to
    // continue: the first step is where a fresh start lands anyway.
    const saved =
      session.procedureId === null || session.stepIndex === 0
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
