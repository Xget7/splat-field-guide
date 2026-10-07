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
import { CATEGORY_TITLE, findReadyGuide } from '../../features/pack/catalog';
import { offersArCheck } from '../../app/arCheck';
import { useCatalog } from '../../app/CatalogContext';
import type { ProcedureId } from '../../features/pack/pack';
import { TOUR_ID } from '../../features/guide/tour';
import { LearnMode, Route, type ScreenProps } from '../../app/routes';
import { Button, IconButton, IconButtonVariant } from '../../ui/Button';
import { ModelPreview, Turns } from '../../features/viewport/ModelPreview';
import { Backdrop, FadingPhoto, Spotlight } from '../../ui/Gradients';
import { ScrollEdge, useScrollOffset } from '../../ui/ScrollEdge';
import { Icon, IconName } from '../../ui/Icon';
import { READOUT_SEPARATOR } from '../../ui/readout';
import { SectionHeader } from '../../ui/SectionHeader';
import {
  BUTTON_HEIGHT,
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Motion,
  Radius,
  Space,
  Type,
} from '../../ui/theme';
import { MODE_OPTIONS } from './guideDetail';
import { checkRowsFor } from '../../features/guide/procedureRows';
import { ProcedureList } from '../ProcedureList';
import { useWideLayout } from '../../ui/useWideLayout';

const Layout = {
  heroHeight: 300,
  // On a tablet in portrait the model gets the room a phone gives the content.
  tallHeroShare: 0.45,
  segmentHeight: 44,
  rowIcon: 20,
  toggleWidth: 44,
  toggleHeight: 26,
  knob: 20,
  // Where the photo starts fading into the backdrop, from its top.
  fadeFrom: 0.4,
  wideColumn: 440,
  wideFadeFrom: 0.5,
} as const;
const AR_TITLE = 'AR check on the real engine';
const VOICE_TITLE = 'Voice assistant';
const TOGGLE_MOTION = LinearTransition.duration(Motion.fast);
const VOICE_CAPTION =
  'Reads each step aloud and listens. Talk over it to cut in.';
const BAR_HEIGHT = Space.md + BUTTON_HEIGHT + Space.sm;

export function GuideDetailScreen({
  navigation,
  route,
}: ScreenProps<typeof Route.guide>) {
  const guide = findReadyGuide(useCatalog(), route.params.guideId);
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const window = useWindowDimensions();
  const sideBySide = wide && window.width > window.height;
  const [mode, setMode] = useState<LearnMode>(LearnMode.instructor);
  const [voice, setVoice] = useState(false);
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
      onPress={() => navigation.goBack()}
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
  const openProcedure = (procedureId: ProcedureId) =>
    navigation.navigate(Route.viewer, {
      guideId: guide.id,
      procedureId,
      stepIndex: 0,
      mode,
      voice: instructor && voice,
    });

  const heading = (
    <View style={styles.heading}>
      <Text style={styles.title}>{guide.title}</Text>
      <Text style={styles.subtitle}>
        {[guide.subtitle, guide.area].join(READOUT_SEPARATOR)}
      </Text>
    </View>
  );
  // Place AR last because it requires access to the physical engine.
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
                <Text
                  style={[styles.modeTitle, selected && styles.selectedTitle]}
                >
                  {option.title}
                </Text>
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
            <Text style={styles.voiceTitle}>{VOICE_TITLE}</Text>
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
      {offersArCheck() && (
        <View style={styles.section}>
          <SectionHeader title="Augmented reality" />
          <Pressable
            testID="open-ar"
            accessibilityRole="button"
            accessibilityLabel={AR_TITLE}
            onPress={() => navigation.navigate(Route.ar, { guideId: guide.id })}
            style={({ pressed }) => [styles.arRow, pressed && styles.pressed]}
          >
            <Icon
              name={IconName.camera}
              size={Layout.rowIcon}
              color={Color.secondaryText}
            />
            <Text style={styles.arTitle}>{AR_TITLE}</Text>
            <Icon
              name={IconName.next}
              size={Layout.rowIcon}
              color={Color.faint}
            />
          </Pressable>
        </View>
      )}
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
  // The model from the library card turns on, below the back button and clear of the title.
  const hero = (fadeFrom: number, clearance: number) => {
    const stage = [
      styles.stage,
      { top: insets.top + Space.sm + MIN_TOUCH, bottom: clearance },
    ];
    return (
      <>
        <View style={stage}>
          <Spotlight id="detail-stage" />
        </View>
        <ModelPreview
          path={guide.model}
          turn={Turns.sway}
          style={stage}
          fallback={
            <FadingPhoto
              id="detail-hero"
              source={guide.image}
              start={fadeFrom}
            />
          }
        />
      </>
    );
  };

  if (sideBySide) {
    return (
      <View testID="guide-detail-screen" style={[styles.screen, styles.split]}>
        <Backdrop />
        <View style={styles.wideHero}>
          {hero(Layout.wideFadeFrom, headingHeight)}
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
          {hero(Layout.fadeFrom, 0)}
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
  stage: { position: 'absolute', left: 0, right: 0 },
  content: {
    paddingHorizontal: Space.lg,
    gap: Space.xl,
  },
  heading: { gap: Space.xs },
  title: { ...Type.largeTitle, color: Color.text },
  subtitle: { ...Type.callout, color: Color.secondaryText },
  section: { gap: Space.sm },
  segments: {
    flexDirection: 'row',
    gap: Space.xxs,
    padding: Space.xxs,
    backgroundColor: Color.raised,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    borderRadius: Radius.round,
  },
  segment: {
    minHeight: Layout.segmentHeight,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.round,
    borderWidth: HAIRLINE,
    borderColor: Color.raised,
  },
  selectedSegment: {
    backgroundColor: Color.pressed,
    borderColor: Color.lineStrong,
  },
  modeTitle: {
    ...Type.calloutStrong,
    flexShrink: 1,
    color: Color.secondaryText,
  },
  selectedTitle: { color: Color.text },
  arRow: {
    minHeight: Layout.segmentHeight,
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
  arTitle: { ...Type.callout, color: Color.text, flex: 1 },
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
  voiceTitle: { ...Type.calloutStrong, flex: 1, color: Color.text },
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
    backgroundColor: Color.accent,
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
  wideContent: { paddingHorizontal: Space.lg, gap: Space.xl },
  wideBar: {
    borderTopWidth: HAIRLINE,
    borderColor: Color.line,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
  },
  missing: { ...Type.callout, color: Color.muted, marginHorizontal: Space.xl },
});
