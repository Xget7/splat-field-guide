import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  LayoutAnimationConfig,
  useReducedMotion,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { SplatError, SplatViewSpec } from 'react-native-splat';
import {
  findReadyGuide,
  type ReadyGuide,
} from '../../../modules/catalog/catalog';
import { useCatalog } from '../../../modules/catalog/CatalogContext';
import { type Pack, type PartId, type ProcedureId } from '../../../domain/pack';
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
import { IconButton } from '../../../shared/ui/kit/Button';
import { IconName } from '../../../shared/ui/kit/Icon';
import { Color, HAIRLINE, Motion, Space, Type } from '../../../shared/ui/theme';
import { partIdForLabel, stepRowsFor } from '../model/guideContent';
import { InstructorPanel } from '../components/InstructorPanel';
import { PartMarkers, type Size } from '../components/PartMarkers';
import { ProcedureSheet } from '../components/ProcedureSheet';
import { SplatViewport } from '../components/SplatViewport';
import { PartList } from '../components/PartList';
import { StepList } from '../components/StepList';
import { StepPanel } from '../components/StepPanel';
import { useGuideFraming } from '../hooks/useGuideFraming';
import { ToolsLayout, ViewerTools } from '../components/ViewerTools';
import { ViewerTopBar } from '../components/ViewerTopBar';
import { useKeyboardVisible } from '../../../shared/hooks/useKeyboardVisible';
import { useWideLayout } from '../../../shared/hooks/useWideLayout';
import { PanelMode } from '../model/panelMotion';
import {
  DOCK_IN,
  DOCK_OUT,
  panelLayout,
  SIDEBAR_IN,
  SIDEBAR_OUT,
} from '../components/InstructorMotion';
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
const EXPLORE_TITLE = 'Explore';
// Wide enough for a step to read in two lines, narrow enough to leave the splat the screen.
const SIDEBAR_WIDTH = 400;

export function ViewerScreen({
  navigation,
  route,
}: ScreenProps<typeof Route.viewer>) {
  const { guideId, procedureId, stepIndex, mode, voice } = route.params;
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
      startInVoice={voice === true && mode === LearnMode.instructor}
      onExit={exit}
    />
  );
}

interface ViewerProps {
  guide: ReadyGuide;
  procedureId: ProcedureId;
  stepIndex: number;
  mode: LearnMode;
  startInVoice: boolean;
  onExit: () => void;
}

function Viewer({
  guide,
  procedureId,
  stepIndex,
  mode,
  startInVoice,
  onExit,
}: ViewerProps) {
  const { pack } = guide;
  const insets = useSafeAreaInsets();
  const [instructorOpen, setInstructorOpen] = useState(
    mode === LearnMode.instructor,
  );
  const {
    session,
    exploring,
    canResume,
    explore,
    resumeGuide,
    finish,
    frameRequest,
    highlight,
    marked,
    card,
    thread,
    exchange,
    voice,
    ask,
    dispatch,
  } = useViewerSession({
    guide,
    procedureId,
    stepIndex,
    instructorOpen,
    instructor: defaultInstructor,
    startInVoice,
  });
  const [view, setView] = useState<SplatViewSpec | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [viewport, setViewport] = useState(NO_SIZE);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [fullView, setFullView] = useState(false);
  const [instructorMode, setInstructorMode] = useState<PanelMode>(
    PanelMode.expanded,
  );
  const keyboardVisible = useKeyboardVisible();
  const wide = useWideLayout();
  const steps = useMemo(() => stepRowsFor(session, pack), [session, pack]);
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

  // Beside a sidebar the splat also resizes when full view folds it away.
  const animatedResize = (instructorOpen || wide) && !reducedMotion;
  useGuideFraming(
    view,
    session,
    pack,
    frameRequest,
    viewport,
    animatedResize,
    viewportSettlement,
    // One part on its own, or a question about what is on screen, is what is being talked about.
    session.selectedPart !== null || exchange !== null,
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
  const onNext = useCallback(() => {
    if (!card.last) {
      dispatch({ type: SessionEventType.next });
      return;
    }
    finish().then(onExit);
  }, [card.last, dispatch, onExit, finish]);
  const onGoTo = useCallback(
    (index: number) =>
      dispatch({ type: SessionEventType.goTo, stepIndex: index }),
    [dispatch],
  );
  const onSelectPart = useCallback(
    (partId: PartId) => dispatch({ type: SessionEventType.select, partId }),
    [dispatch],
  );
  // With no guide set aside, the guide to follow has to be chosen first.
  const onGuide = useCallback(() => {
    setFullView(false);
    if (!exploring) {
      return;
    }
    if (canResume) {
      resumeGuide();
    } else {
      setPickerVisible(true);
    }
  }, [exploring, canResume, resumeGuide]);
  const onExplore = useCallback(() => {
    setFullView(false);
    explore();
  }, [explore]);
  const tools = (layout: ToolsLayout) => (
    <ViewerTools
      exploring={exploring}
      onGuide={onGuide}
      onExplore={onExplore}
      layout={layout}
      fullView={fullView}
      // A phone has no sidebar to fold away.
      onFullView={wide ? () => setFullView(full => !full) : undefined}
    />
  );
  const onChooseProcedure = useCallback(
    (id: ProcedureId) => {
      dispatch({ type: SessionEventType.start, procedureId: id });
      setPickerVisible(false);
    },
    [dispatch],
  );

  const viewportView = (
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
        materialize={!reducedMotion}
        error={error}
        onView={setView}
        onReady={onReady}
        onError={onError}
        onPick={onPick}
      />
      {ready && (
        <PartMarkers
          view={view}
          parts={marked}
          size={viewport}
          enterAfter={reducedMotion ? 0 : Motion.reveal}
        />
      )}
      {!wide && (
        <View style={styles.toolsTop}>{tools(ToolsLayout.floating)}</View>
      )}
      {wide && fullView && (
        <Animated.View
          testID="viewer-dock"
          entering={DOCK_IN}
          exiting={DOCK_OUT}
          pointerEvents="box-none"
          style={[styles.toolsBottom, { bottom: insets.bottom + Space.md }]}
        >
          {tools(ToolsLayout.floating)}
        </Animated.View>
      )}
    </Animated.View>
  );
  const panel = instructorOpen ? (
    <InstructorPanel
      thread={thread}
      exchange={exchange}
      content={card}
      bottomInset={bottomInset}
      onAsk={ask}
      voice={voice}
      mode={wide ? PanelMode.expanded : instructorMode}
      onModeChange={setInstructorMode}
      onBack={onBack}
      onNext={onNext}
      docked={wide}
    />
  ) : (
    <StepPanel
      content={card}
      bottomInset={bottomInset}
      onBack={onBack}
      onNext={onNext}
      onRepeat={onRepeat}
      docked={wide}
    />
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
          currentProcedure(session, pack)?.title ??
          (exploring && canResume ? EXPLORE_TITLE : NO_PROCEDURE_TITLE)
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
      {wide ? (
        // The sidebar is there from the start; it only slides when full view gives it back.
        <LayoutAnimationConfig skipEntering>
          <View style={styles.split}>
            {viewportView}
            {!fullView && (
              <Animated.View
                testID="viewer-sidebar"
                entering={SIDEBAR_IN}
                exiting={SIDEBAR_OUT}
                style={styles.sidebar}
              >
                {tools(ToolsLayout.sidebar)}
                {exploring ? (
                  <View style={styles.steps}>
                    <PartList
                      parts={pack.parts}
                      selected={session.selectedPart}
                      onSelect={onSelectPart}
                    />
                  </View>
                ) : (
                  steps.length > 0 && (
                    <View style={styles.steps}>
                      <StepList
                        rows={steps}
                        current={session.stepIndex}
                        onSelect={onGoTo}
                        expanded={instructorOpen}
                      />
                    </View>
                  )
                )}
                {panel}
              </Animated.View>
            )}
          </View>
        </LayoutAnimationConfig>
      ) : (
        <>
          {viewportView}
          {panel}
        </>
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
  split: { flex: 1, flexDirection: 'row' },
  // The steps on top, then the panel, which sits at the foot as it does under the splat.
  sidebar: {
    width: SIDEBAR_WIDTH,
    borderLeftWidth: HAIRLINE,
    borderLeftColor: Color.line,
    backgroundColor: Color.black,
  },
  toolsTop: { position: 'absolute', top: Space.md, left: Space.md },
  // Folded out of the sidebar, the tools float at the foot of the splat.
  toolsBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // The steps take the height the panel under them leaves.
  steps: { flex: 1 },
  missing: {
    flex: 1,
    gap: Space.lg,
    paddingHorizontal: Space.lg,
    backgroundColor: Color.black,
  },
  missingText: { ...Type.callout, color: Color.muted },
});
