import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CATEGORY_TITLE,
  findReadyGuide,
  type Guide,
  type GuideId,
} from '../../pack/catalog';
import type { ProcedureId } from '../../pack/pack';
import { TOUR_ID } from '../../pack/tour';
import { LearnMode } from '../domain/learningMode';
import type { SessionStart } from '../domain/sessionStart';
import { Button, IconButton, IconButtonVariant } from '../../../ui/Button';
import { Backdrop } from '../../../ui/Gradients';
import { GuidePreview } from './GuidePreview';
import { ScrollEdge, useScrollOffset } from '../../../ui/ScrollEdge';
import { Icon, IconName } from '../../../ui/Icon';
import { READOUT_SEPARATOR } from '../../../ui/readout';
import { SectionHeader } from '../../../ui/SectionHeader';
import {
  BUTTON_HEIGHT,
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Motion,
  Radius,
  Space,
  Type,
} from '../../../ui/theme';
import { MODE_OPTIONS } from './guideDetail';
import { checkRowsFor } from '../domain/procedureRows';
import { ProcedureList } from './ProcedureList';
import { useWideLayout } from '../../../ui/useWideLayout';

const Layout = {
  heroHeight: 300,
  // On a tablet in portrait the model gets the room a phone gives the content.
  tallHeroShare: 0.45,
  rowIcon: 20,
  toggleWidth: 44,
  toggleHeight: 26,
  knob: 20,
  wideColumn: 440,
} as const;
const VOICE_TITLE = 'Voice assistant';
const TOGGLE_MOTION = LinearTransition.duration(Motion.fast);
const VOICE_CAPTION =
  'Reads each step aloud and listens. Talk over it to cut in.';
const BAR_HEIGHT = Space.md + BUTTON_HEIGHT + Space.sm;

export interface GuideDetailScreenProps {
  readonly catalog: readonly Guide[];
  /** Only the visible entry owns a native preview. */
  readonly active?: boolean;
  readonly guideId: GuideId;
  readonly onBack: () => void;
  /** Opens the viewer on the first step of a procedure. */
  readonly onOpen: (start: SessionStart) => void;
}

export function GuideDetailScreen({
  catalog,
  active = true,
  guideId,
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
  useEffect(() => {
    if (active) setOpening(false);
  }, [active, guideId]);
  const instructor = mode === LearnMode.instructor;
  const [headingHeight, setHeadingHeight] = useState(0);
  const scroll = useScrollOffset();
  // Each layout mounts its own scroll view, which starts at the top.
  useEffect(() => {
    scroll.offset.value = 0;
  }, [sideBySide, scroll.offset]);
  const back = (
    <IconButton
      testID="guide-back"
      icon={IconName.back}
      variant={IconButtonVariant.overlay}
      accessibilityLabel="Back"
      onPress={() => {
        setOpening(true);
        onBack();
      }}
      style={{ ...styles.back, top: insets.top + Space.sm }}
    />
  );

  if (!guide) {
    return (
      <View testID="guide-detail-screen" style={styles.screen}>
        <Backdrop />
        {back}
        <Text
          style={[
            styles.missing,
            { marginTop: insets.top + Space.sm + MIN_TOUCH + Space.xl },
          ]}
        >
          Guide unavailable.
        </Text>
      </View>
    );
  }

  const checks = checkRowsFor(guide.pack);
  // Voice belongs to the instructor, so a self-guided start never opens it.
  const openProcedure = (procedureId: ProcedureId) => {
    // Release the preview in the same transition that mounts the activity viewer.
    setOpening(true);
    onOpen({
      guideId: guide.id,
      procedureId,
      stepIndex: 0,
      mode,
      voice: instructor && voice,
    });
  };

  const subtitle = [guide.subtitle, guide.area]
    .filter(Boolean)
    .join(READOUT_SEPARATOR);
  const machines = guide.pack.parts.filter(part => part.parent === null).length;
  const heading = (
    <View style={styles.heading}>
      <Text style={styles.title}>{guide.title}</Text>
      {subtitle !== '' && <Text style={styles.subtitle}>{subtitle}</Text>}
      <View style={styles.facts}>
        <Text style={styles.fact}>{`${machines} assemblies`}</Text>
        <Text style={styles.fact}>{`${guide.pack.parts.length} parts`}</Text>
        <Text style={styles.fact}>{`${checks.length} procedures`}</Text>
      </View>
    </View>
  );
  const choices = (
    <>
      <View style={styles.section}>
        <SectionHeader title="Guidance" />
        <View
          accessibilityLabel={`${CATEGORY_TITLE[guide.category]} mode`}
          style={styles.segments}
        >
          {MODE_OPTIONS.map(option => {
            const selected = mode === option.mode;
            return (
              <Pressable
                key={option.mode}
                testID={option.testID}
                accessibilityRole="button"
                accessibilityLabel={option.title}
                accessibilityHint={option.caption}
                accessibilityState={{ selected }}
                onPress={() => setMode(option.mode)}
                style={[styles.segment, selected && styles.selectedSegment]}
              >
                <Icon
                  name={option.icon}
                  color={selected ? Color.accent : Color.secondaryText}
                />
                <View style={styles.modeCopy}>
                  <Text
                    style={[styles.modeTitle, selected && styles.selectedTitle]}
                  >
                    {option.title}
                  </Text>
                  <Text style={styles.modeCaption}>{option.caption}</Text>
                </View>
                <Icon
                  name={selected ? IconName.check : IconName.next}
                  size={16}
                  color={selected ? Color.accent : Color.muted}
                />
              </Pressable>
            );
          })}
        </View>
        {instructor && (
          <Pressable
            testID="voice-assistant"
            accessibilityRole="switch"
            accessibilityLabel={VOICE_TITLE}
            accessibilityHint={VOICE_CAPTION}
            accessibilityState={{ checked: voice }}
            onPress={() => setVoice(on => !on)}
            style={({ pressed }) => [
              styles.voiceRow,
              pressed && styles.pressed,
            ]}
          >
            <Icon
              name={IconName.handsFree}
              size={Layout.rowIcon}
              color={voice ? Color.accent : Color.secondaryText}
            />
            <View style={styles.modeCopy}>
              <Text style={styles.voiceTitle}>{VOICE_TITLE}</Text>
              <Text style={styles.modeCaption}>
                {voice
                  ? 'Voice starts with your instructor session.'
                  : 'Optional. Start with text, or enable voice.'}
              </Text>
            </View>
            {/* The custom switch avoids the iOS 26 switch exceeding its React Native frame. */}
            <View style={[styles.toggle, voice && styles.toggleOn]}>
              <Animated.View layout={TOGGLE_MOTION} style={styles.knob} />
            </View>
          </Pressable>
        )}
      </View>
      <View style={styles.section}>
        <SectionHeader title="Procedures" />
        <ProcedureList rows={checks} onChoose={openProcedure} />
      </View>
    </>
  );
  const start = (
    <Button
      testID="start-tour"
      label="Start parts tour"
      accessibilityLabel="Start parts tour"
      onPress={() => openProcedure(TOUR_ID)}
    />
  );
  const hero = (clearance: number) => (
    <View
      style={[
        styles.stage,
        { top: insets.top + Space.sm + MIN_TOUCH, bottom: clearance },
      ]}
    >
      {active && !opening && <GuidePreview pack={guide.pack} />}
    </View>
  );

  if (sideBySide) {
    return (
      <View testID="guide-detail-screen" style={[styles.screen, styles.split]}>
        <Backdrop />
        <View style={styles.wideHero}>
          {hero(headingHeight)}
          <View
            style={[
              styles.wideHeading,
              { paddingBottom: insets.bottom + Space.xl },
            ]}
            onLayout={event =>
              setHeadingHeight(event.nativeEvent.layout.height)
            }
          >
            {heading}
          </View>
        </View>
        <View style={styles.wideColumn}>
          <Animated.ScrollView
            contentContainerStyle={[
              styles.wideContent,
              { paddingTop: insets.top + Space.lg },
            ]}
            contentInsetAdjustmentBehavior="never"
            onScroll={scroll.onScroll}
          >
            {choices}
          </Animated.ScrollView>
          <ScrollEdge offset={scroll.offset} />
          <View
            style={[
              styles.wideBar,
              { paddingBottom: insets.bottom + Space.sm },
            ]}
          >
            {start}
          </View>
        </View>
        {back}
      </View>
    );
  }

  return (
    <View testID="guide-detail-screen" style={styles.screen}>
      <Backdrop />
      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingBottom: BAR_HEIGHT + insets.bottom + Space.xl,
        }}
        contentInsetAdjustmentBehavior="never"
        onScroll={scroll.onScroll}
      >
        <View
          style={[
            styles.hero,
            wide && { height: window.height * Layout.tallHeroShare },
          ]}
        >
          {hero(0)}
        </View>
        <View style={styles.content}>
          {heading}
          {choices}
        </View>
      </Animated.ScrollView>
      <ScrollEdge offset={scroll.offset} />
      {back}
      <View
        testID="guide-start-bar"
        style={[styles.bottomBar, { paddingBottom: insets.bottom + Space.sm }]}
      >
        {start}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Color.surface },
  scroll: { flex: 1 },
  back: { position: 'absolute', left: Space.lg },
  hero: { height: Layout.heroHeight, overflow: 'hidden' },
  stage: {
    position: 'absolute',
    left: Space.lg,
    right: Space.lg,
    overflow: 'hidden',
    borderRadius: Radius.card,
  },
  content: {
    paddingHorizontal: Space.lg,
    gap: Space.xl,
  },
  heading: { gap: Space.md },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  fact: {
    ...Type.footnote,
    color: Color.secondaryText,
    paddingVertical: Space.xs,
    paddingHorizontal: Space.sm,
    backgroundColor: Color.raised,
    borderRadius: Radius.field,
  },
  title: { ...Type.largeTitle, color: Color.text },
  subtitle: { ...Type.callout, color: Color.secondaryText },
  section: { gap: Space.sm },
  segments: { gap: Space.sm },
  segment: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.card,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    backgroundColor: Color.raised,
  },
  selectedSegment: {
    backgroundColor: Color.accentWash,
    borderColor: Color.accent,
  },
  modeCopy: { flex: 1, gap: Space.xs },
  modeCaption: { ...Type.footnote, color: Color.secondaryText },
  modeTitle: {
    ...Type.calloutStrong,
    flexShrink: 1,
    color: Color.secondaryText,
  },
  selectedTitle: { color: Color.text },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.card,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    backgroundColor: Color.raised,
  },
  voiceTitle: { ...Type.calloutStrong, color: Color.text },
  toggle: {
    width: Layout.toggleWidth,
    height: Layout.toggleHeight,
    borderRadius: Radius.round,
    padding: (Layout.toggleHeight - HAIRLINE * 2 - Layout.knob) / 2,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    backgroundColor: Color.pressed,
    alignItems: 'flex-start',
  },
  toggleOn: {
    borderColor: Color.accent,
    backgroundColor: Color.accentFill,
    alignItems: 'flex-end',
  },
  knob: {
    width: Layout.knob,
    height: Layout.knob,
    borderRadius: Radius.round,
    backgroundColor: Color.accentText,
  },
  pressed: { backgroundColor: Color.pressed },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Color.surface,
    borderTopWidth: HAIRLINE,
    borderColor: Color.line,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
  },
  split: { flexDirection: 'row' },
  wideHero: { flex: 1, overflow: 'hidden' },
  wideHeading: {
    position: 'absolute',
    left: Space.xl,
    right: Space.xl,
    bottom: 0,
  },
  wideColumn: {
    width: Layout.wideColumn,
    borderLeftWidth: HAIRLINE,
    borderLeftColor: Color.line,
  },
  wideContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xl,
    gap: Space.xl,
  },
  wideBar: {
    borderTopWidth: HAIRLINE,
    borderColor: Color.line,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
  },
  missing: { ...Type.callout, color: Color.muted, marginHorizontal: Space.xl },
});
