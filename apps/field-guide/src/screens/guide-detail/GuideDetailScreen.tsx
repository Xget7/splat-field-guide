import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CATEGORY_TITLE, findReadyGuide } from '../../pack/catalog';
import { useCatalog } from '../../navigation/CatalogContext';
import type { ProcedureId } from '../../pack/pack';
import { TOUR_ID } from '../../guide/tour';
import { LearnMode, Route, type ScreenProps } from '../../navigation/routes';
import { Button, IconButton, IconButtonVariant } from '../../ui/Button';
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
import { checkRowsFor } from '../../guide/procedureRows';
import { ProcedureList } from '../ProcedureList';
import { useWideLayout } from '../../ui/useWideLayout';

const Layout = {
  heroHeight: 220,
  // A tablet held upright keeps the stacked layout with more of the photo.
  wideHeroHeight: 420,
  titleOverlap: 44,
  segmentHeight: 44,
  warningIcon: 16,
  rowIcon: 20,
  toggleWidth: 44,
  toggleHeight: 26,
  knob: 20,
  fadeHeight: '60%',
  // Wide, the photo takes the left and the choices a column on the right.
  wideColumn: 440,
  wideFadeHeight: '50%',
} as const;
const HERO_FADE = `linear-gradient(to bottom, ${Color.black}00, ${Color.black})`;
const AR_TITLE = 'AR check on the real engine';
const VOICE_TITLE = 'Voice assistant';
const TOGGLE_MOTION = LinearTransition.duration(Motion.fast);
const VOICE_CAPTION =
  'Reads each step aloud and listens. Talk over it to cut in.';
const INITIAL_BAR_HEIGHT =
  Space.md + Type.footnote.lineHeight + Space.md + BUTTON_HEIGHT + Space.sm;

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
  const [barHeight, setBarHeight] = useState(
    INITIAL_BAR_HEIGHT + insets.bottom,
  );
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
  // Most important first: how to be guided, then what to do. The AR check needs the real
  // engine at hand, so it comes last.
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
                <Text style={styles.modeTitle}>{option.title}</Text>
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
              voice && styles.voiceRowOn,
              pressed && styles.pressed,
            ]}
          >
            <Icon
              name={IconName.handsFree}
              size={Layout.rowIcon}
              color={voice ? Color.accent : Color.secondaryText}
            />
            <Text style={styles.voiceTitle}>{VOICE_TITLE}</Text>
            {/* Drawn rather than native: the row is the switch, and the iOS 26 switch
                outgrows the frame React Native gives it. */}
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
    </>
  );
  const start = (
    <>
      <View style={styles.safetyRow}>
        <Icon
          name={IconName.warn}
          color={Color.caution}
          size={Layout.warningIcon}
        />
        <Text style={styles.safety}>{guide.safety}</Text>
      </View>
      <Button
        testID="start-tour"
        label="Start parts tour"
        accessibilityLabel="Start parts tour"
        onPress={() => openProcedure(TOUR_ID)}
      />
    </>
  );

  if (sideBySide) {
    return (
      <View testID="guide-detail-screen" style={[styles.screen, styles.split]}>
        <View style={styles.wideHero}>
          <Image
            source={guide.image}
            resizeMode="cover"
            style={styles.heroImage}
          />
          <View pointerEvents="none" style={styles.wideFade} />
          <View
            style={[
              styles.wideHeading,
              { paddingBottom: insets.bottom + Space.xl },
            ]}
          >
            {heading}
          </View>
        </View>
        <View style={styles.wideColumn}>
          <ScrollView
            contentContainerStyle={[
              styles.wideContent,
              { paddingTop: insets.top + Space.lg },
            ]}
            contentInsetAdjustmentBehavior="never"
          >
            {choices}
          </ScrollView>
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
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingBottom: barHeight + Space.xl }}
        contentInsetAdjustmentBehavior="never"
      >
        <View style={[styles.hero, wide && styles.tallHero]}>
          <Image
            source={guide.image}
            resizeMode="cover"
            style={styles.heroImage}
          />
          <View pointerEvents="none" style={styles.fade} />
        </View>
        <View style={styles.content}>
          {heading}
          {choices}
        </View>
      </ScrollView>
      {back}
      <View
        testID="guide-start-bar"
        style={[styles.bottomBar, { paddingBottom: insets.bottom + Space.sm }]}
        // Measure the wrapped safety text so larger text never covers the final row.
        onLayout={event => setBarHeight(event.nativeEvent.layout.height)}
      >
        {start}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Color.black },
  back: { position: 'absolute', left: Space.lg },
  hero: { height: Layout.heroHeight, overflow: 'hidden' },
  tallHero: { height: Layout.wideHeroHeight },
  // Sized explicitly: an Image from a bundled asset otherwise keeps the asset's height.
  heroImage: { width: '100%', height: '100%' },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: Layout.fadeHeight,
    experimental_backgroundImage: HERO_FADE,
  },
  content: {
    marginTop: -Layout.titleOverlap,
    paddingHorizontal: Space.lg,
    gap: Space.xl,
  },
  heading: { gap: Space.xs },
  title: { ...Type.largeTitle, color: Color.text },
  subtitle: { ...Type.callout, color: Color.secondaryText },
  section: { gap: Space.sm },
  segments: {
    flexDirection: 'row',
    backgroundColor: Color.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.lineStrong,
    borderRadius: Radius.md,
  },
  segment: {
    minHeight: Layout.segmentHeight,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.raised,
  },
  selectedSegment: {
    backgroundColor: Color.accentWash,
    borderColor: Color.accent,
  },
  modeTitle: { ...Type.calloutStrong, flexShrink: 1, color: Color.text },
  arRow: {
    minHeight: Layout.segmentHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.lineStrong,
    backgroundColor: Color.raised,
  },
  arTitle: { ...Type.callout, color: Color.text, flex: 1 },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.lineStrong,
    backgroundColor: Color.raised,
  },
  voiceRowOn: { borderColor: Color.accent },
  voiceTitle: { ...Type.calloutStrong, flex: 1, color: Color.text },
  toggle: {
    width: Layout.toggleWidth,
    height: Layout.toggleHeight,
    borderRadius: Radius.sm,
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
    borderRadius: Radius.sm,
    backgroundColor: Color.accentText,
  },
  pressed: { backgroundColor: Color.pressed },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Color.black,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Color.line,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    gap: Space.md,
  },
  split: { flexDirection: 'row' },
  wideHero: { flex: 1, overflow: 'hidden' },
  wideFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: Layout.wideFadeHeight,
    experimental_backgroundImage: HERO_FADE,
  },
  wideHeading: {
    position: 'absolute',
    left: Space.xl,
    right: Space.xl,
    bottom: 0,
  },
  wideColumn: {
    width: Layout.wideColumn,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: Color.line,
  },
  wideContent: { paddingHorizontal: Space.lg, gap: Space.xl },
  wideBar: {
    backgroundColor: Color.black,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Color.line,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    gap: Space.md,
  },
  safetyRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  safety: { ...Type.footnote, color: Color.caution, flex: 1 },
  missing: { ...Type.callout, color: Color.muted, marginHorizontal: Space.xl },
});
