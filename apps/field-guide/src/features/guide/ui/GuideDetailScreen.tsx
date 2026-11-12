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
import { IconButton, IconButtonVariant } from '../../../ui/Button';
import { Backdrop } from '../../../ui/Gradients';
import { IconName } from '../../../ui/Icon';
import { ScrollEdge, useScrollOffset } from '../../../ui/ScrollEdge';
import { Color, HAIRLINE, Radius, Space, Type } from '../../../ui/theme';
import { useWideLayout } from '../../../ui/useWideLayout';
import {
  MachineList,
  ModuleList,
  ReferenceSection,
  Section,
} from './CourseSections';
import { GuidePreview } from './GuidePreview';
import { StartBar } from './StartBar';

// One gutter sets the outer margin, the gap between the columns and the space between sections,
// so the back button, title, preview and right column share a single grid.
const GUTTER = Space.xl;

const Layout = {
  phonePreview: 300,
  // On a tablet in portrait the model gets the room a phone gives the content.
  tallPreviewShare: 0.45,
  // The right column takes this share of a landscape window, within readable line lengths.
  columnShare: 0.36,
  minColumn: 400,
  maxColumn: 520,
  // Long summaries wrap before they become hard to follow across a landscape window.
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
  const [mode, setMode] = useState<LearnMode>(LearnMode.instructor);
  const [voice, setVoice] = useState(false);
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
    paddingTop: insets.top + Space.sm,
    paddingLeft: insets.left + GUTTER,
    paddingRight: insets.right + GUTTER,
  };
  const bottom = Math.max(insets.bottom, GUTTER);
  const back = (
    <IconButton
      testID="guide-back"
      icon={IconName.back}
      variant={IconButtonVariant.raised}
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
        <Backdrop />
        <View style={styles.header}>
          {back}
          <Text style={styles.missing}>Guide unavailable.</Text>
        </View>
      </View>
    );
  }

  const { pack } = guide;
  const outline = courseOutlineFor(pack);
  // Voice belongs to the instructor, so a self-guided start never opens it.
  const openProcedure = (procedureId: ProcedureId) => {
    // Release the preview in the same transition that mounts the activity viewer.
    setOpening(true);
    onOpen({
      guideId: guide.id,
      procedureId,
      stepIndex: 0,
      mode,
      voice: mode === LearnMode.instructor && voice,
    });
  };

  const header = (
    <View style={styles.header}>
      {back}
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {guide.title}
        </Text>
        {pack.summary !== undefined && (
          <Text style={styles.summary}>{pack.summary}</Text>
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
    <StartBar
      mode={mode}
      onMode={setMode}
      voice={voice}
      onVoice={setVoice}
      tour={outline.tour}
      onStart={() => openProcedure(TOUR_ID)}
    />
  );

  if (sideBySide) {
    const column = Math.min(
      Layout.maxColumn,
      Math.max(Layout.minColumn, window.width * Layout.columnShare),
    );
    return (
      <View
        testID="guide-detail-screen"
        style={[styles.screen, frame, { paddingBottom: bottom }]}
      >
        <Backdrop />
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
      <Backdrop />
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
            paddingBottom: insets.bottom + Space.sm,
          },
        ]}
      >
        {start}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Color.surface },
  scroll: { flex: 1 },
  header: { gap: Space.md },
  heading: { gap: Space.xs },
  title: { ...Type.largeTitle, color: Color.text },
  summary: {
    ...Type.body,
    color: Color.secondaryText,
    maxWidth: Layout.summaryWidth,
  },
  stage: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: Radius.card,
    backgroundColor: Color.canvasTop,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
    gap: GUTTER,
    marginTop: GUTTER,
  },
  columnContent: { gap: GUTTER, paddingBottom: GUTTER },
  columnBar: {
    paddingTop: Space.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: Color.line,
  },
  stack: { gap: GUTTER },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: Space.md,
    backgroundColor: Color.surface,
    borderTopWidth: HAIRLINE,
    borderTopColor: Color.line,
  },
  missing: { ...Type.callout, color: Color.muted },
});
