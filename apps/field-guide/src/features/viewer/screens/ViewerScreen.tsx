import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  findReadyGuide,
  type ReadyGuide,
} from '../../../modules/catalog/catalog';
import { useCatalog } from '../../../modules/catalog/CatalogContext';
import { type Pack, type ProcedureId } from '../../../domain/pack';
import {
  currentProcedure,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../../../domain/session';
import { defaultInstructor } from '../../../modules/instructor/data/defaultInstructor';
import {
  LearnMode,
  Route,
  type ScreenProps,
} from '../../../shared/navigation/routes';
import { clearProgress } from '../../../modules/progress/data/progressStorage';
import { IconButton } from '../../../shared/ui/kit/Button';
import { IconName } from '../../../shared/ui/kit/Icon';
import { Color, Space, Type } from '../../../shared/ui/theme';
import { partIdForLabel } from '../model/guideContent';
import { InstructorPanel } from '../components/InstructorPanel';
import { PartMarkers, type Size } from '../components/PartMarkers';
import { ProcedureSheet } from '../components/ProcedureSheet';
import { SplatViewport } from '../components/SplatViewport';
import { StepPanel } from '../components/StepPanel';
import { useGuideFraming } from '../hooks/useGuideFraming';
import { ViewerTopBar } from '../components/ViewerTopBar';
import { useKeyboardVisible } from '../../../shared/hooks/useKeyboardVisible';
import { PanelMode } from '../model/panelMotion';
import { panelLayout } from '../components/InstructorMotion';
import { useViewerSession } from '../hooks/useViewerSession';

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
  const [instructorOpen, setInstructorOpen] = useState(
    mode === LearnMode.instructor,
  );
  const {
    session,
    frameRequest,
    highlight,
    marked,
    card,
    message,
    voice,
    ask,
    dispatch,
  } = useViewerSession({
    guide,
    procedureId,
    stepIndex,
    instructorOpen,
    instructor: defaultInstructor,
  });
  const [view, setView] = useState<SplatViewSpec | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [viewport, setViewport] = useState(NO_SIZE);
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
