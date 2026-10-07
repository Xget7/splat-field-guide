import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  LayoutAnimationConfig,
  useReducedMotion,
} from 'react-native-reanimated';
import { findReadyGuide, type ReadyGuide } from '../../features/pack/catalog';
import { useCatalog } from '../../app/CatalogContext';
import {
  type Pack,
  type PartId,
  type ProcedureId,
} from '../../features/pack/pack';
import {
  currentProcedure,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../../features/guide/session';
import { useInstructorRuntime } from '../../app/InstructorRuntimeContext';
import type { InstructorRuntime } from '../../app/instructorRuntime';
import { LearnMode, Route, type ScreenProps } from '../../app/routes';
import { IconButton } from '../../ui/Button';
import { IconName } from '../../ui/Icon';
import { Color, Space, Type } from '../../ui/theme';
import { cardPartFor, partTrailFor, stepRowsFor } from './guideContent';
import { AssistantDock, DOCK_EXPANDED_HEIGHT } from './assistant/AssistantDock';
import { ExploreDrawer } from './shell/ExploreDrawer';
import { GuideDrawer } from './shell/GuideDrawer';
import { Capability, DRAWER_IN, DRAWER_OUT } from './shell/layout';
import { ViewerRail } from './shell/ViewerRail';
import { Breadcrumb } from './stage/Breadcrumb';
import { PartCard } from './stage/PartCard';
import { DevPanel } from './stage/DevPanel';
import { ToolDock } from './stage/ToolDock';
import { cardClearanceFor, stageDocksFor } from './stage/stageDocks';
import type { Size } from '../../features/viewport/projectedParts';
import { InstructorPanel } from './instructor/InstructorPanel';
import { ProcedureSheet } from './ProcedureSheet';
import { SplatViewport } from '../../features/viewport/SplatViewport';
import { StepPanel } from './StepPanel';
import { ViewerTools } from './ViewerTools';
import { ViewerTopBar } from './ViewerTopBar';
import { useKeyboardVisible } from '../../ui/useKeyboardVisible';
import { useWideLayout } from '../../ui/useWideLayout';
import { PanelMode } from './instructor/panelMotion';
import { FADE_IN, FADE_OUT, panelLayout } from './instructor/InstructorMotion';
import { useViewerSession } from './useViewerSession';

/** Development-only interface for Metro checks of the live viewer. */
export interface FieldGuideDebug {
  dispatch: (event: SessionEvent) => void;
  ask: (question: string) => void;
  getState: () => SessionState;
  pack: Pack;
}

const NO_PROCEDURE_TITLE = 'Choose procedure';
const EXPLORE_TITLE = 'Explore';
const BREADCRUMB_HEIGHT = 40;
const NO_SIZE: Size = { width: 0, height: 0 };

export function ViewerScreen({
  navigation,
  route,
}: ScreenProps<typeof Route.viewer>) {
  const runtime = useInstructorRuntime();
  const { guideId, procedureId, stepIndex, mode, voice } = route.params;
  const guide = findReadyGuide(useCatalog(), guideId);
  const exit = useCallback(() => navigation.goBack(), [navigation]);
  if (guide === undefined) {
    return <MissingGuide onBack={exit} />;
  }
  return (
    <Viewer
      runtime={runtime}
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
  runtime: InstructorRuntime;
  guide: ReadyGuide;
  procedureId: ProcedureId;
  stepIndex: number;
  mode: LearnMode;
  startInVoice: boolean;
  onExit: () => void;
}

function Viewer({
  runtime,
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
    runtime,
    startInVoice,
  });
  const [pickerVisible, setPickerVisible] = useState(false);
  const [fullView, setFullView] = useState(false);
  const [labelsOn, setLabelsOn] = useState(true);
  // Recentering frames the step again without asking the instructor to repeat it.
  const [recenters, setRecenters] = useState(0);
  const [loadedMs, setLoadedMs] = useState<number | null>(null);
  const [stage, setStage] = useState<Size>(NO_SIZE);
  const [toolsWidth, setToolsWidth] = useState(0);
  const docks = stageDocksFor(stage.width, toolsWidth);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [instructorMode, setInstructorMode] = useState<PanelMode>(
    PanelMode.expanded,
  );
  const keyboardVisible = useKeyboardVisible();
  const wide = useWideLayout();
  const steps = useMemo(() => stepRowsFor(session, pack), [session, pack]);
  const trail = useMemo(() => partTrailFor(session, pack), [session, pack]);
  const cardPart = useMemo(() => cardPartFor(session, pack), [session, pack]);
  const alreadyShown = useMemo(
    () => [card.title, card.body, card.caution, cardPart?.summary ?? ''],
    [card, cardPart],
  );
  const reducedMotion = useReducedMotion();
  const viewportTransition = useMemo(() => panelLayout(), []);
  const sessionRef = useRef(session);
  // Over the keyboard the home indicator is hidden, so the panel needs no room for it.
  const bottomInset = keyboardVisible ? 0 : insets.bottom;

  const animatedResize = (instructorOpen || wide) && !reducedMotion;
  useEffect(() => {
    sessionRef.current = session;
    if (__DEV__) {
      const target = globalThis as { fieldGuide?: FieldGuideDebug };
      const debug: FieldGuideDebug = {
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
  }, [session, pack, dispatch, ask]);

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
    (partId: PartId | null) =>
      dispatch({ type: SessionEventType.select, partId }),
    [dispatch],
  );
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
  const capability = exploring ? Capability.explore : Capability.guide;
  const onCapability = useCallback(
    (next: Capability) => {
      if (next === capability) {
        setFullView(full => !full);
      } else if (next === Capability.explore) {
        onExplore();
      } else {
        onGuide();
      }
    },
    [capability, onExplore, onGuide],
  );
  const onAssistantExpanded = useCallback((expanded: boolean) => {
    setAssistantExpanded(expanded);
    if (expanded) {
      setInstructorOpen(true);
    }
  }, []);
  const leave = useCallback(() => {
    voice.stop();
    onExit();
  }, [voice, onExit]);
  const procedureTitle =
    currentProcedure(session, pack)?.title ??
    (exploring && canResume ? EXPLORE_TITLE : NO_PROCEDURE_TITLE);
  const onChooseProcedure = useCallback(
    (id: ProcedureId) => {
      dispatch({ type: SessionEventType.start, procedureId: id });
      setPickerVisible(false);
    },
    [dispatch],
  );

  const assistantMaxHeight = Math.max(
    0,
    stage.height -
      insets.top -
      insets.bottom -
      BREADCRUMB_HEIGHT -
      Space.xxl * 2,
  );
  const cardClearance = cardClearanceFor(
    stage,
    docks,
    insets.top + Space.sm + BREADCRUMB_HEIGHT + Space.sm,
    insets.bottom + Space.lg,
    assistantExpanded
      ? Math.min(DOCK_EXPANDED_HEIGHT, assistantMaxHeight)
      : null,
  );
  const stageOverlays = wide && (
    <>
      <View
        pointerEvents="box-none"
        style={[styles.breadcrumb, { top: insets.top + Space.sm }]}
      >
        <Breadcrumb
          area={guide.area}
          trail={trail}
          onArea={() => onSelectPart(null)}
          onPart={onSelectPart}
        />
      </View>
      {labelsOn && (
        <PartCard part={cardPart} stage={stage} clear={cardClearance} />
      )}
      {!(assistantExpanded && docks.toolsCovered) && (
        <Animated.View
          entering={FADE_IN}
          exiting={FADE_OUT}
          pointerEvents="box-none"
          style={[
            styles.toolDock,
            {
              right: docks.toolsRight,
              bottom: insets.bottom + Space.lg + docks.toolsLift,
            },
          ]}
        >
          <View
            onLayout={event => setToolsWidth(event.nativeEvent.layout.width)}
          >
            <ToolDock
              labelsOn={labelsOn}
              fullView={fullView}
              canRepeat={!exploring}
              dev={<DevPanel pack={pack} loadedMs={loadedMs} />}
              onRecenter={() => setRecenters(count => count + 1)}
              onToggleLabels={() => setLabelsOn(on => !on)}
              onRepeat={onRepeat}
              onToggleFullView={() => setFullView(full => !full)}
            />
          </View>
        </Animated.View>
      )}
      <View
        pointerEvents="box-none"
        style={[styles.assistant, { bottom: insets.bottom + Space.lg }]}
      >
        <AssistantDock
          thread={thread}
          exchange={exchange}
          alreadyShown={alreadyShown}
          onAsk={ask}
          voice={voice}
          expanded={assistantExpanded}
          onExpandedChange={onAssistantExpanded}
          collapsedWidth={docks.assistantWidth}
          expandedWidth={docks.assistantExpandedWidth}
          bottomInset={0}
          maxHeight={assistantMaxHeight}
        />
      </View>
    </>
  );
  const viewportView = (
    <SplatViewport
      pack={pack}
      session={session}
      frameRequest={frameRequest + recenters}
      closeUp={session.selectedPart !== null || exchange !== null}
      accessibilityLabel={`${guide.title}, ${guide.area}`}
      resizeTransition={animatedResize ? viewportTransition : undefined}
      markers={labelsOn}
      carded={wide ? cardPart?.id ?? null : null}
      onSelect={onSelectPart}
      onLoaded={setLoadedMs}
    >
      {!wide && (
        <View style={styles.toolsTop}>
          <ViewerTools
            exploring={exploring}
            onGuide={onGuide}
            onExplore={onExplore}
          />
        </View>
      )}
      {stageOverlays}
    </SplatViewport>
  );
  const panel = instructorOpen ? (
    <InstructorPanel
      thread={thread}
      exchange={exchange}
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
  );

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[
        styles.root,
        { paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      {wide ? (
        // Skip initial entry animation because the drawer is present from mount.
        <LayoutAnimationConfig skipEntering>
          <View style={styles.shell}>
            <ViewerRail
              topInset={insets.top}
              bottomInset={insets.bottom}
              capability={capability}
              drawerOpen={!fullView}
              onBack={leave}
              onCapability={onCapability}
            />
            {!fullView && (
              <Animated.View
                entering={DRAWER_IN}
                exiting={DRAWER_OUT}
                style={styles.drawer}
              >
                {exploring ? (
                  <ExploreDrawer
                    topInset={insets.top}
                    bottomInset={insets.bottom}
                    parts={pack.parts}
                    selected={session.selectedPart}
                    onSelect={onSelectPart}
                    onClose={() => setFullView(true)}
                  />
                ) : (
                  <GuideDrawer
                    topInset={insets.top}
                    bottomInset={insets.bottom}
                    procedureTitle={procedureTitle}
                    onChooseProcedure={() => setPickerVisible(true)}
                    steps={steps}
                    current={session.stepIndex}
                    onGoTo={onGoTo}
                    content={card}
                    onBack={onBack}
                    onNext={onNext}
                    onClose={() => setFullView(true)}
                  />
                )}
              </Animated.View>
            )}
            <View
              testID="viewer-stage"
              style={styles.stage}
              onLayout={event => {
                const { width, height } = event.nativeEvent.layout;
                setStage({ width, height });
              }}
            >
              {viewportView}
            </View>
          </View>
        </LayoutAnimationConfig>
      ) : (
        <>
          <ViewerTopBar
            topInset={insets.top}
            procedureTitle={procedureTitle}
            instructorOpen={instructorOpen}
            onBack={leave}
            onChooseProcedure={() => setPickerVisible(true)}
            onToggleInstructor={() => {
              voice.stop();
              setInstructorOpen(open => !open);
            }}
          />
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
  shell: { flex: 1, flexDirection: 'row' },
  drawer: { flexDirection: 'row' },
  stage: { flex: 1 },
  toolsTop: { position: 'absolute', top: Space.md, left: Space.md },
  breadcrumb: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toolDock: { position: 'absolute', left: 0, alignItems: 'center' },
  assistant: { position: 'absolute', right: Space.lg },
  missing: {
    flex: 1,
    gap: Space.lg,
    paddingHorizontal: Space.lg,
    backgroundColor: Color.surface,
  },
  missingText: { ...Type.callout, color: Color.muted },
});
