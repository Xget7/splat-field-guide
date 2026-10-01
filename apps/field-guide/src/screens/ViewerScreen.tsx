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
import type { SplatError, SplatViewSpec } from 'react-native-splat';
import { findReadyGuide, type ReadyGuide } from '../catalog/catalog';
import { useCatalog } from '../catalog/CatalogContext';
import { highlightFor } from '../domain/derive';
import type { Pack, ProcedureId } from '../domain/pack';
import {
  currentProcedure,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../domain/session';
import { suggestionsFor } from '../instructor/instructor';
import { LearnMode, Route, type ScreenProps } from '../navigation/routes';
import { clearProgress, saveProgress } from '../progress/progress';
import { IconButton, IconName } from '../ui/kit';
import { Color, Space, Type } from '../ui/theme';
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
import { stepLabel } from '../ui/readout';
import { useGuideFraming } from './viewer/useGuideFraming';
import { ViewerTopBar } from './viewer/ViewerTopBar';
import { useKeyboardVisible } from './viewer/useKeyboardVisible';
import {
  initialViewerState,
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
  const keyboardVisible = useKeyboardVisible();
  const sessionRef = useRef(session);
  const pickGeneration = useRef(0);

  const highlight = useMemo(
    () => [...highlightFor(session, pack)],
    [session, pack],
  );
  const marked = useMemo(() => markedPartsFor(session, pack), [session, pack]);
  const card = useMemo(() => cardContentFor(session, pack), [session, pack]);
  const suggestions = useMemo(
    () => suggestionsFor(session, pack),
    [session, pack],
  );
  const message: InstructorMessage = exchange ?? {
    question: null,
    reply: card.body,
    caution: card.caution,
  };
  const step =
    card.stepCount > 0 ? stepLabel(card.stepNumber, card.stepCount) : null;
  // Over the keyboard the home indicator is hidden, so the panel needs no room for it.
  const bottomInset = keyboardVisible ? 0 : insets.bottom;

  useGuideFraming(view, session, pack, frameRequest, viewport);

  const dispatch = useCallback(
    (event: SessionEvent) => act({ type: ViewerActionType.session, event }),
    [],
  );
  const ask = useCallback(
    (question: string) => act({ type: ViewerActionType.ask, question }),
    [],
  );

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
  const onNext = useCallback(() => {
    if (!card.last) {
      dispatch({ type: SessionEventType.next });
      return;
    }
    // Finished: nothing is left to continue.
    clearProgress().catch(failure =>
      console.warn('Field guide: progress not cleared', failure),
    );
    onExit();
  }, [card.last, dispatch, onExit]);
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
        onBack={onExit}
        onChooseProcedure={() => setPickerVisible(true)}
        onToggleInstructor={() => setInstructorOpen(open => !open)}
      />
      <View
        testID="viewer-viewport"
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
      </View>
      {instructorOpen ? (
        <InstructorPanel
          message={message}
          step={step}
          suggestions={suggestions}
          bottomInset={bottomInset}
          onAsk={ask}
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
