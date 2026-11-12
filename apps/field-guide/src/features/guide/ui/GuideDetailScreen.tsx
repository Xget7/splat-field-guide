import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { findReadyGuide, type Guide, type GuideId } from '../../pack/catalog';
import type { PartId, ProcedureId } from '../../pack/pack';
import { TOUR_ID } from '../../pack/tour';
import type { CourseDocuments } from '../../../platform/documents';
import { courseOutlineFor } from '../domain/courseOutline';
import { LearnMode } from '../domain/learningMode';
import type { SessionStart } from '../domain/sessionStart';
import { CourseSurface } from '../../../ui/CourseSurface';
import { IconName } from '../../../ui/Icon';
import { ScrollEdge, useScrollOffset } from '../../../ui/ScrollEdge';
import {
  CourseColor as C,
  CourseRadius as R,
  CourseType as T,
  Grid as G,
} from '../../../ui/courseTokens';
import { useWideLayout } from '../../../ui/useWideLayout';
import {
  MachineList,
  ModuleList,
  ReferenceSection,
  Section,
} from './CourseSections';
import { CourseButton, CourseIconButton } from './CourseControls';
import { GuidePreview } from './GuidePreview';

// One gutter sets the outer margin, the gap between the columns and the space between sections,
// so the back button, title, preview and right column share a single grid.
const GUTTER = G.medium;

const Layout = {
  phonePreview: 300,
  // On a tablet in portrait the model gets the room a phone gives the content.
  tallPreviewShare: 0.45,
  // The right column takes this share of a landscape window, within readable line lengths.
  columnShare: 0.36,
  minColumn: 400,
  maxColumn: 520,
  // Long summaries wrap before they become hard to follow across a wide window.
  summaryWidth: 720,
} as const;

const Copy = {
  startHere: 'Start here',
  machines: 'Robots',
  documentation: 'KUKA documentation',
} as const;

export interface GuideDetailScreenProps {
  readonly catalog: readonly Guide[];
  /** Only the visible entry owns a native preview. */
  readonly active?: boolean;
  readonly guideId: GuideId;
  /** Opens cited manual pages; without it references show as unavailable. */
  readonly documents?: CourseDocuments;
  readonly onBack: () => void;
  /** Opens the viewer on the first step of a procedure. */
  readonly onOpen: (start: SessionStart) => void;
}

export function GuideDetailScreen({
  catalog,
  active = true,
  guideId,
  documents,
  onBack,
  onOpen,
}: GuideDetailScreenProps) {
  const guide = findReadyGuide(catalog, guideId);
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const window = useWindowDimensions();
  const sideBySide = wide && window.width > window.height;
  const [opening, setOpening] = useState(false);
  const [focus, setFocus] = useState<PartId | null>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    if (active) setOpening(false);
  }, [active, guideId]);
  const scroll = useScrollOffset();
  // Each layout mounts its own scroll view, which starts at the top.
  useEffect(() => {
    scroll.offset.value = 0;
  }, [sideBySide, scroll.offset]);
  const frame = {
    paddingTop: insets.top + G.unit,
    paddingLeft: insets.left + GUTTER,
    paddingRight: insets.right + GUTTER,
  };
  const bottom = Math.max(insets.bottom, GUTTER);
  const back = (
    <CourseIconButton
      testID="guide-back"
      icon={IconName.back}
      accessibilityLabel="Back"
      onPress={() => {
        setOpening(true);
        onBack();
      }}
    />
  );

  if (!guide) {
    return (
      <View testID="guide-detail-screen" style={[styles.screen, frame]}>
        <CourseSurface />
        <View style={styles.header}>
          {back}
          <Text style={styles.missing}>Guide unavailable.</Text>
        </View>
      </View>
    );
  }

  const { pack } = guide;
  const outline = courseOutlineFor(pack);
  // Every start opens the instructor speaking; the learner turns voice off in the viewer,
  // and a voice that cannot start falls back to text there.
  const openProcedure = (procedureId: ProcedureId) => {
    // Release the preview in the same transition that mounts the activity viewer.
    setOpening(true);
    onOpen({
      guideId: guide.id,
      procedureId,
      stepIndex: 0,
      mode: LearnMode.instructor,
      voice: true,
    });
  };

  const column = Math.min(
    Layout.maxColumn,
    Math.max(Layout.minColumn, window.width * Layout.columnShare),
  );
  // Beside the columns the summary ends where the preview does, so the header shares the grid.
  const summaryWidth = sideBySide
    ? window.width - insets.left - insets.right - GUTTER * 3 - column
    : Layout.summaryWidth;
  const header = (
    <View style={styles.header}>
      {back}
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {guide.title}
        </Text>
        {pack.summary !== undefined && (
          <Text style={[styles.summary, { maxWidth: summaryWidth }]}>
            {pack.summary}
          </Text>
        )}
      </View>
    </View>
  );
  const preview = (
    <View testID="guide-stage" style={styles.stage}>
      {active && !opening && <GuidePreview pack={pack} focus={focus} />}
    </View>
  );
  const sections = (
    <>
      {outline.startHere.length > 0 && (
        <Section title={Copy.startHere}>
          <ModuleList rows={outline.startHere} onChoose={openProcedure} />
        </Section>
      )}
      {outline.machines.length > 0 && (
        <Section title={Copy.machines}>
          <MachineList
            machines={outline.machines}
            focus={focus}
            onFocus={setFocus}
            onChoose={openProcedure}
          />
        </Section>
      )}
      <ReferenceSection
        title={Copy.documentation}
        references={pack.references}
        documents={documents}
      />
    </>
  );
  const start = (
    <CourseButton
      testID="start-tour"
      label="Start parts tour"
      onPress={() => openProcedure(TOUR_ID)}
    />
  );

  if (sideBySide) {
    return (
      <View
        testID="guide-detail-screen"
        style={[styles.screen, frame, { paddingBottom: bottom }]}
      >
        <CourseSurface />
        {header}
        <View style={styles.columns}>
          {preview}
          <View style={{ width: column }}>
            <Animated.ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.columnContent}
              contentInsetAdjustmentBehavior="never"
              showsVerticalScrollIndicator={false}
            >
              {sections}
            </Animated.ScrollView>
            <View testID="guide-start-bar" style={styles.columnBar}>
              {start}
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View testID="guide-detail-screen" style={styles.screen}>
      <CourseSurface />
      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.stack,
          frame,
          { paddingBottom: barHeight + GUTTER },
        ]}
        contentInsetAdjustmentBehavior="never"
        onScroll={scroll.onScroll}
      >
        {header}
        <View
          style={{
            height: wide
              ? window.height * Layout.tallPreviewShare
              : Layout.phonePreview,
          }}
        >
          {preview}
        </View>
        {sections}
      </Animated.ScrollView>
      <ScrollEdge offset={scroll.offset} />
      <View
        testID="guide-start-bar"
        onLayout={event => setBarHeight(event.nativeEvent.layout.height)}
        style={[
          styles.bottomBar,
          {
            paddingLeft: insets.left + GUTTER,
            paddingRight: insets.right + GUTTER,
            paddingBottom: insets.bottom + G.unit,
          },
        ]}
      >
        {start}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  scroll: { flex: 1 },
  header: { gap: G.small },
  heading: { gap: G.unit },
  title: { ...T.title, color: C.text },
  summary: { ...T.body, color: C.secondary },
  stage: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: R.card,
    backgroundColor: C.surface,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
    gap: GUTTER,
    marginTop: GUTTER,
  },
  columnContent: { gap: GUTTER, paddingBottom: GUTTER },
  // The line marks where the list scrolls under the pinned button.
  columnBar: {
    paddingTop: G.small,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  stack: { gap: GUTTER },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: G.small,
    backgroundColor: C.canvas,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  missing: { ...T.body, color: C.secondary },
});
