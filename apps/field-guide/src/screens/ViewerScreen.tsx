import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { SplatError, SplatViewSpec } from 'react-native-splat';
import { findReadyGuide, type ReadyGuide } from '../catalog/catalog';
import { useCatalog } from '../catalog/CatalogContext';
import { highlightFor } from '../domain/derive';
import { findPart, type Pack, type ProcedureId } from '../domain/pack';
import {
  currentProcedure,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../domain/session';
import {
  cancelInstructor,
  usesModel,
  modelAnswer,
  prewarmInstructor,
} from '../instructor/onDevice';
import { LearnMode, Route, type ScreenProps } from '../navigation/routes';
import { clearProgress, saveProgress } from '../progress/progress';
import { IconButton, IconName } from '../ui/kit';
import { Color, Space, Type } from '../ui/theme';
import { useInstructorVoice } from '../voice/useInstructorVoice';
import {
  cardContentFor,
  markedPartsFor,
  partIdForLabel,
} from './viewer/guideContent';
import {
  InstructorPanel,
  type InstructorMessage,
} from './viewer/InstructorPanel';
import { PartMarkers, type Size } from './viewer/PartMarkers';
import { ProcedureSheet } from './viewer/ProcedureSheet';
import { SplatViewport } from './viewer/SplatViewport';
import { StepPanel } from './viewer/StepPanel';
import { useGuideFraming } from './viewer/useGuideFraming';
import { ViewerTopBar } from './viewer/ViewerTopBar';
import { useKeyboardVisible } from './viewer/useKeyboardVisible';
import { PanelMode } from './viewer/panelMotion';
import { panelLayout } from './viewer/InstructorMotion';
import {
  initialViewerState,
  ExchangePhase,
  reduceViewer,
  ViewerActionType,
  type ViewerAction,
  type ViewerState,
} from './viewer/viewerState';

/** Metro end-to-end checks drive the live viewer through this, in development only. */
export interface FieldGuideDebug {
  view: SplatViewSpec | null;
  dispatch: (event: SessionEvent) => void;
  ask: (question: string) => void;
  getState: () => SessionState;
  pack: Pack;
}

const NO_SIZE: Size = { width: 0, height: 0 };
const NO_PROCEDURE_TITLE = 'Choose procedure';

export function ViewerScreen({
  navigation,
  route,
}: ScreenProps<typeof Route.viewer>) {
  const { guideId, procedureId, stepIndex, mode } = route.params;
  const guide = findReadyGuide(useCatalog(), guideId);
  const exit = useCallback(() => navigation.goBack(), [navigation]);
  if (guide === undefined) {
    return <MissingGuide onBack={exit} />;
  }
  return (
    <Viewer
      guide={guide}
      procedureId={procedureId}
      stepIndex={stepIndex}
      mode={mode}
      onExit={exit}
    />
  );
}

interface ViewerProps {
  guide: ReadyGuide;
  procedureId: ProcedureId;
  stepIndex: number;
  mode: LearnMode;
  onExit: () => void;
}

function Viewer({ guide, procedureId, stepIndex, mode, onExit }: ViewerProps) {
  const { pack } = guide;
  const insets = useSafeAreaInsets();
  const [state, act] = useReducer(
    (current: ViewerState, action: ViewerAction) =>
      reduceViewer(current, action, pack),
    null,
    () => initialViewerState(procedureId, stepIndex, pack),
  );
  const { session, exchange, frameRequest } = state;
  const [view, setView] = useState<SplatViewSpec | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [viewport, setViewport] = useState(NO_SIZE);
  const [instructorOpen, setInstructorOpen] = useState(
    mode === LearnMode.instructor,
  );
  const [pickerVisible, setPickerVisible] = useState(false);
  const [instructorMode, setInstructorMode] = useState<PanelMode>(
    PanelMode.expanded,
  );
  const keyboardVisible = useKeyboardVisible();
  const reducedMotion = useReducedMotion();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [viewportSettlement, setViewportSettlement] = useState(0);
  const settleViewport = useCallback(() => {
    if (mounted.current) {
      setViewportSettlement(value => value + 1);
    }
  }, []);
  const viewportLayout = useMemo(
    () =>
      panelLayout().withCallback(finished => {
        'worklet';
        if (finished) {
          scheduleOnRN(settleViewport);
        }
      }),
    [settleViewport],
  );
  const sessionRef = useRef(session);
  const pickGeneration = useRef(0);
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
  const message: InstructorMessage = exchange ?? {
    id: null,
    question: null,
    reply: card.body,
    caution: card.caution,
  };
  // Over the keyboard the home indicator is hidden, so the panel needs no room for it.
  const bottomInset = keyboardVisible ? 0 : insets.bottom;

  const animatedResize = instructorOpen && !reducedMotion;
  useGuideFraming(
    view,
    session,
    pack,
    frameRequest,
    viewport,
    animatedResize,
    viewportSettlement,
  );

  const invalidateAnswer = useCallback(() => {
    answerGeneration.current += 1;
    if (modelRequest.current !== null) {
      modelRequest.current = null;
      cancelInstructor();
    }
  }, []);
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
      if (!usesModel(question, pack)) {
        act({ type: ViewerActionType.ask, question, id });
        return;
      }
      modelRequest.current = id;
      act({ type: ViewerActionType.begin, question, id });
      const previous =
        current.exchange?.phase === ExchangePhase.done
          ? current.exchange
          : null;
      modelAnswer(question, current.session, pack, previous, partial => {
        if (id === answerGeneration.current) {
          act({ type: ViewerActionType.partial, id, partial });
        }
      }).then(answer => {
        if (id === answerGeneration.current) {
          modelRequest.current = null;
          act({ type: ViewerActionType.answer, id, answer });
        }
      });
    },
    [pack, invalidateAnswer],
  );

  const voice = useInstructorVoice({
    pack,
    enabled: instructorOpen,
    exchange,
    onAsk: ask,
    onCancel: cancelAnswer,
  });
  interruptVoice.current = voice.interrupt;

  useEffect(() => {
    if (instructorOpen) {
      prewarmInstructor(pack);
    }
  }, [instructorOpen, pack]);

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

  useEffect(() => {
    sessionRef.current = session;
    if (__DEV__) {
      const target = globalThis as { fieldGuide?: FieldGuideDebug };
      const debug: FieldGuideDebug = {
        view,
        dispatch,
        ask,
        getState: () => sessionRef.current,
        pack,
      };
      target.fieldGuide = debug;
      return () => {
        if (target.fieldGuide === debug) {
          delete target.fieldGuide;
        }
      };
    }
  }, [session, view, pack, dispatch, ask]);

  useEffect(() => {
    // A delayed pick must not overwrite a newer step or an unmounted screen.
    pickGeneration.current += 1;
    return () => {
      pickGeneration.current += 1;
    };
  }, [session, view, pack]);

  const onPick = useCallback(
    async (x: number, y: number) => {
      if (view === null) {
        return;
      }
      const generation = ++pickGeneration.current;
      try {
        const label = await view.pick(x, y);
        if (generation !== pickGeneration.current) {
          return;
        }
        const partId = partIdForLabel(label, pack);
        if (partId !== undefined) {
          dispatch({ type: SessionEventType.select, partId });
        }
      } catch (thrown) {
        if (generation === pickGeneration.current) {
          setError(thrown instanceof Error ? thrown.message : String(thrown));
        }
      }
    },
    [view, pack, dispatch],
  );
  const onReady = useCallback(() => {
    setReady(true);
    setError('');
  }, []);
  const onError = useCallback(
    (failure: SplatError) => setError(failure.message),
    [],
  );
  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport(current =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);
  const onBack = useCallback(
    () => dispatch({ type: SessionEventType.back }),
    [dispatch],
  );
  const onRepeat = useCallback(
    () => dispatch({ type: SessionEventType.repeat }),
    [dispatch],
  );
  const stopVoice = voice.stop;
  const onNext = useCallback(() => {
    if (!card.last) {
      dispatch({ type: SessionEventType.next });
      return;
    }
    // Finished: nothing is left to continue.
    stopVoice();
    clearProgress().catch(failure =>
      console.warn('Field guide: progress not cleared', failure),
    );
    onExit();
  }, [card.last, dispatch, onExit, stopVoice]);
  const onChooseProcedure = useCallback(
    (id: ProcedureId) => {
      dispatch({ type: SessionEventType.start, procedureId: id });
      setPickerVisible(false);
    },
    [dispatch],
  );

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[
        styles.root,
        { paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <ViewerTopBar
        topInset={insets.top}
        procedureTitle={
          currentProcedure(session, pack)?.title ?? NO_PROCEDURE_TITLE
        }
        instructorOpen={instructorOpen}
        onBack={() => {
          voice.stop();
          onExit();
        }}
        onChooseProcedure={() => setPickerVisible(true)}
        onToggleInstructor={() => {
          voice.stop();
          setInstructorOpen(open => !open);
        }}
      />
      <Animated.View
        testID="viewer-viewport"
        layout={animatedResize ? viewportLayout : undefined}
        style={styles.viewport}
        onLayout={onViewportLayout}
      >
        <SplatViewport
          pack={pack}
          highlight={highlight}
          view={view}
          size={viewport}
          accessibilityLabel={`${guide.title}, ${guide.area}`}
          loading={!ready}
          error={error}
          onView={setView}
          onReady={onReady}
          onError={onError}
          onPick={onPick}
        />
        {ready && <PartMarkers view={view} parts={marked} size={viewport} />}
      </Animated.View>
      {instructorOpen ? (
        <InstructorPanel
          message={message}
          content={card}
          bottomInset={bottomInset}
          onAsk={ask}
          voice={voice}
          part={exchange?.part ? findPart(pack, exchange.part) ?? null : null}
          onFramePart={partId =>
            act({ type: ViewerActionType.framePart, partId })
          }
          mode={instructorMode}
          onModeChange={setInstructorMode}
          onBack={onBack}
          onNext={onNext}
        />
      ) : (
        <StepPanel
          content={card}
          bottomInset={bottomInset}
          onBack={onBack}
          onNext={onNext}
          onRepeat={onRepeat}
        />
      )}
      <ProcedureSheet
        visible={pickerVisible}
        pack={pack}
        current={session.procedureId}
        onChoose={onChooseProcedure}
        onClose={() => setPickerVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

function MissingGuide({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.missing, { paddingTop: insets.top + Space.sm }]}>
      <IconButton
        testID="viewer-back"
        icon={IconName.back}
        accessibilityLabel="Back"
        onPress={onBack}
      />
      <Text style={styles.missingText}>This guide is not on this device.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.black },
  viewport: { flex: 1 },
  missing: {
    flex: 1,
    gap: Space.lg,
    paddingHorizontal: Space.lg,
    backgroundColor: Color.black,
  },
  missingText: { ...Type.callout, color: Color.muted },
});
