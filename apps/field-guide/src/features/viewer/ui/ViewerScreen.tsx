import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  LayoutAnimationConfig,
  useReducedMotion,
} from 'react-native-reanimated';
import { findReadyGuide, type ReadyGuide } from '../../pack/catalog';
import { useCatalog } from '../../../app/context/CatalogContext';
import { type Pack, type ProcedureId } from '../../pack/pack';
import {
  currentProcedure,
  type SessionEvent,
  type SessionState,
  LearnMode,
} from '../../guide';
import { clearProgress, saveProgress } from '../../guide/views';
import {
  useInstructor,
  useInstructorVoice,
  panelLayout,
} from '../../instructor/views';
import type { Instructor } from '../../instructor';

import { Route, type ScreenProps } from '../../../app/navigation/routes';

import { Capability } from '../domain/capability';
import { NO_SIZE, type Size } from '../domain/screenGeometry';
import {
  attachProgressAutosave,
  type ProgressWriter,
} from '../data/progressAutosave';
import { selectDisplay, viewerStore } from '../state/viewerStore';
import {
  useCanResume,
  useCard,
  useCardPart,
  useDisplayedSession,
  useExchange,
  useExploring,
  useFrameRequest,
  usePartTrail,
  useShownText,
  useStepRows,
  useThread,
  useUtterance,
  useViewerLayout,
  useVoiceContext,
} from '../state/viewerHooks';
import { IconButton } from '../../../ui/Button';
import { IconName } from '../../../ui/Icon';
import { FADE_IN, FADE_OUT_FAST } from '../../../ui/motion';
import { Color, Space, Type } from '../../../ui/theme';

import { AssistantDock } from './instructor/AssistantDock';
import { ExploreDrawer } from './shell/ExploreDrawer';
import { GuideDrawer } from './shell/GuideDrawer';
import { DOCK_EXPANDED_HEIGHT, DRAWER_IN, DRAWER_OUT } from './shell/layout';
import { ViewerRail } from './shell/ViewerRail';
import { Breadcrumb, BREADCRUMB_HEIGHT } from './stage/Breadcrumb';
import { PartCard } from './stage/PartCard';
import { DevPanel } from './stage/DevPanel';
import { ToolDock } from './stage/ToolDock';
import { cardClearanceFor, stageDocksFor } from './stage/stageDocks';

import { InstructorPanel } from './instructor/InstructorPanel';
import { ProcedureSheet } from './ProcedureSheet';
import { SplatViewport } from './viewport/SplatViewport';
import { StepPanel } from './StepPanel';
import { ViewerTools } from './ViewerTools';
import { ViewerTopBar } from './ViewerTopBar';
import { useKeyboardVisible } from '../../../ui/useKeyboardVisible';
import { useWideLayout } from '../../../ui/useWideLayout';

/** Development-only interface for Metro checks of the live viewer. */
export interface FieldGuideDebug {
  dispatch: (event: SessionEvent) => void;
  ask: (question: string) => void;
  getState: () => SessionState;
  pack: Pack;
}

const NO_PROCEDURE_TITLE = 'Choose procedure';
const EXPLORE_TITLE = 'Explore';
const PROGRESS: ProgressWriter = { save: saveProgress, clear: clearProgress };

export function ViewerScreen({
  navigation,
  route,
}: ScreenProps<typeof Route.viewer>) {
  const instructor = useInstructor();
  const { guideId, procedureId, stepIndex, mode, voice } = route.params;
  const guide = findReadyGuide(useCatalog(), guideId);
  const exit = useCallback(() => navigation.goBack(), [navigation]);
  if (guide === undefined) {
    return <MissingGuide onBack={exit} />;
  }
  return (
    <Viewer
      instructor={instructor}
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
  instructor: Instructor;
  guide: ReadyGuide;
  procedureId: ProcedureId;
  stepIndex: number;
  mode: LearnMode;
  startInVoice: boolean;
  onExit: () => void;
}

function Viewer({
  instructor,
  guide,
  procedureId,
  stepIndex,
  mode,
  startInVoice,
  onExit,
}: ViewerProps) {
  const { pack } = guide;
  // Opened during the first render, so the first frame already shows the requested step.
  useState(() =>
    viewerStore
      .getState()
      .open({ guide, procedureId, stepIndex, mode, instructor }),
  );
  // Actions never change, so reading them once per render is enough.
  const actions = viewerStore.getState();
  const insets = useSafeAreaInsets();
  const {
    instructorOpen,
    panelMode,
    instructorDockExpanded,
    fullView,
    labelsOn,
    pickerVisible,
  } = useViewerLayout();
  const session = useDisplayedSession();
  const exploring = useExploring();
  const canResume = useCanResume();
  const card = useCard();
  const thread = useThread();
  const exchange = useExchange();
  const steps = useStepRows();
  const trail = usePartTrail();
  const cardPart = useCardPart();
  const shownText = useShownText();
  const frameRequest = useFrameRequest();
  const utterance = useUtterance();
  const voiceContext = useVoiceContext();
  const voice = useInstructorVoice({
    pack,
    enabled: instructorOpen,
    utterance,
    context: voiceContext,
    runtime: instructor,
    onTurn: actions.receiveTurn,
    onAction: actions.applyAgentAction,
    onIdle: idle => instructor.setIdle(idle),
    onAsk: actions.ask,
    onCancel: actions.cancelAnswer,
    startInVoice,
  });
  const { ask: askVoice, interrupt: interruptVoice, stop: stopVoice } = voice;
  useEffect(() => {
    viewerStore.getState().attachVoice({
      ask: askVoice,
      interrupt: interruptVoice,
      stop: stopVoice,
    });
  }, [askVoice, interruptVoice, stopVoice]);
  // Declared after the voice hook, so leaving stops speech before the answer is cancelled.
  useEffect(() => {
    const detach = attachProgressAutosave(viewerStore, PROGRESS);
    return () => {
      detach();
      viewerStore.getState().close();
    };
  }, []);
  const [loadedMs, setLoadedMs] = useState<number | null>(null);
  const [stage, setStage] = useState<Size>(NO_SIZE);
  const [toolsWidth, setToolsWidth] = useState(0);
  const docks = stageDocksFor(stage.width, toolsWidth);
  const keyboardVisible = useKeyboardVisible();
  const wide = useWideLayout();
  const reducedMotion = useReducedMotion();
  const viewportTransition = useMemo(() => panelLayout(), []);
  // Over the keyboard the home indicator is hidden, so the panel needs no room for it.
  const bottomInset = keyboardVisible ? 0 : insets.bottom;

  const animatedResize = (instructorOpen || wide) && !reducedMotion;
  useEffect(() => {
    if (__DEV__) {
      const target = globalThis as { fieldGuide?: FieldGuideDebug };
      const debug: FieldGuideDebug = {
        dispatch: viewerStore.getState().dispatch,
        ask: viewerStore.getState().ask,
        getState: () => selectDisplay(viewerStore.getState()).session,
        pack,
      };
      target.fieldGuide = debug;
      return () => {
        if (target.fieldGuide === debug) {
          delete target.fieldGuide;
        }
      };
    }
  }, [pack]);

  const onNext = useCallback(() => {
    if (viewerStore.getState().next()) {
      onExit();
    }
  }, [onExit]);
  const leave = useCallback(() => {
    stopVoice();
    onExit();
  }, [stopVoice, onExit]);
  const capability = exploring ? Capability.explore : Capability.guide;
  const procedureTitle =
    currentProcedure(session, pack)?.title ??
    (exploring && canResume ? EXPLORE_TITLE : NO_PROCEDURE_TITLE);

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
    instructorDockExpanded
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
          onArea={() => actions.select(null)}
          onPart={actions.select}
        />
      </View>
      {labelsOn && (
        <PartCard part={cardPart} stage={stage} clear={cardClearance} />
      )}
      {!(instructorDockExpanded && docks.toolsCovered) && (
        <Animated.View
          entering={FADE_IN}
          exiting={FADE_OUT_FAST}
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
              onRecenter={actions.recenter}
              onToggleLabels={actions.toggleLabels}
              onRepeat={actions.repeat}
              onToggleFullView={actions.toggleFullView}
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
          alreadyShown={shownText}
          onAsk={actions.ask}
          voice={voice}
          expanded={instructorDockExpanded}
          onExpandedChange={actions.setInstructorDockExpanded}
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
      frameRequest={frameRequest}
      closeUp={session.selectedPart !== null || exchange !== null}
      accessibilityLabel={`${guide.title}, ${guide.area}`}
      resizeTransition={animatedResize ? viewportTransition : undefined}
      markers={labelsOn}
      carded={wide ? cardPart?.id ?? null : null}
      onSelect={actions.select}
      onLoaded={setLoadedMs}
    >
      {!wide && (
        <View style={styles.toolsTop}>
          <ViewerTools
            exploring={exploring}
            onGuide={actions.resumeGuide}
            onExplore={actions.explore}
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
      onAsk={actions.ask}
      voice={voice}
      mode={panelMode}
      onModeChange={actions.setPanelMode}
      onBack={actions.back}
      onNext={onNext}
    />
  ) : (
    <StepPanel
      content={card}
      bottomInset={bottomInset}
      onBack={actions.back}
      onNext={onNext}
      onRepeat={actions.repeat}
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
              onCapability={actions.chooseCapability}
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
                    onSelect={actions.select}
                    onClose={actions.closeDrawer}
                  />
                ) : (
                  <GuideDrawer
                    topInset={insets.top}
                    bottomInset={insets.bottom}
                    procedureTitle={procedureTitle}
                    onChooseProcedure={actions.openPicker}
                    steps={steps}
                    current={session.stepIndex}
                    onGoTo={actions.goTo}
                    content={card}
                    onBack={actions.back}
                    onNext={onNext}
                    onClose={actions.closeDrawer}
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
            onChooseProcedure={actions.openPicker}
            onToggleInstructor={actions.toggleInstructor}
          />
          {viewportView}
          {panel}
        </>
      )}
      <ProcedureSheet
        visible={pickerVisible}
        pack={pack}
        current={session.procedureId}
        onChoose={actions.chooseProcedure}
        onClose={actions.closePicker}
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
