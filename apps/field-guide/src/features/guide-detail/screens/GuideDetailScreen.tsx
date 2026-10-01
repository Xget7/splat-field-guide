import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CATEGORY_TITLE,
  findReadyGuide,
  packFacts,
} from '../../../modules/catalog/catalog';
import { useCatalog } from '../../../modules/catalog/CatalogContext';
import type { ProcedureId } from '../../../domain/pack';
import { TOUR_ID } from '../../../domain/tour';
import {
  LearnMode,
  Route,
  type ScreenProps,
} from '../../../shared/navigation/routes';
import {
  Button,
  IconButton,
  IconButtonVariant,
} from '../../../shared/ui/kit/Button';
import { Icon, IconName } from '../../../shared/ui/kit/Icon';
import { Label } from '../../../shared/ui/kit/Label';
import {
  BUTTON_HEIGHT,
  Color,
  MIN_TOUCH,
  Radius,
  Space,
  Type,
} from '../../../shared/ui/theme';
import { MODE_OPTIONS } from '../model/guideDetail';
import { procedureRowsFor } from '../../../modules/procedures/model/procedureRows';
import { ProcedureList } from '../../../modules/procedures/components/ProcedureList';

const Layout = {
  heroHeight: 220,
  titleOverlap: 44,
  segmentHeight: 44,
  warningIcon: 16,
  rowIcon: 20,
  fadeFraction: 0.6,
} as const;
const HERO_FADE = `linear-gradient(to bottom, ${Color.black}00, ${Color.black})`;
const SEPARATOR = ' · ';
const AR_TITLE = 'AR check on the real engine';
const INITIAL_BAR_HEIGHT =
  Space.md + Type.footnote.lineHeight + Space.md + BUTTON_HEIGHT + Space.sm;

export function GuideDetailScreen({
  navigation,
  route,
}: ScreenProps<typeof Route.guide>) {
  const guide = findReadyGuide(useCatalog(), route.params.guideId);
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<LearnMode>(LearnMode.instructor);
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

  const facts = packFacts(guide.pack);
  const rows = procedureRowsFor(guide.pack);
  const summary = [
    `${facts.parts} parts`,
    `${rows.length} procedures`,
    `${facts.size} offline`,
  ].join(SEPARATOR);
  const openProcedure = (procedureId: ProcedureId) =>
    navigation.navigate(Route.viewer, {
      guideId: guide.id,
      procedureId,
      stepIndex: 0,
      mode,
    });

  return (
    <View testID="guide-detail-screen" style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingBottom: barHeight + Space.xl }}
        contentInsetAdjustmentBehavior="never"
      >
        <View style={styles.hero}>
          <Image
            source={guide.image}
            resizeMode="cover"
            style={styles.heroImage}
          />
          <View pointerEvents="none" style={styles.fade} />
        </View>
        <View style={styles.content}>
          <View style={styles.heading}>
            <Text style={styles.title}>{guide.title}</Text>
            <Text style={styles.subtitle}>
              {[guide.subtitle, guide.area].join(SEPARATOR)}
            </Text>
            <Text testID="guide-summary" style={styles.summary}>
              {summary}
            </Text>
          </View>
          <View style={styles.section}>
            <View
              accessibilityLabel={`${CATEGORY_TITLE[guide.category]} mode`}
              style={styles.segments}
            >
              {MODE_OPTIONS.map(option => {
                const selected = mode === option.mode;
                const color = selected ? Color.accentText : Color.text;
                return (
                  <Pressable
                    key={option.mode}
                    testID={option.testID}
                    accessibilityRole="button"
                    accessibilityLabel={option.title}
                    accessibilityState={{ selected }}
                    onPress={() => setMode(option.mode)}
                    style={[styles.segment, selected && styles.selectedSegment]}
                  >
                    <Icon name={option.icon} color={color} />
                    <Text style={[styles.modeTitle, { color }]}>
                      {option.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              testID="open-ar"
              accessibilityRole="button"
              accessibilityLabel={AR_TITLE}
              onPress={() =>
                navigation.navigate(Route.ar, { guideId: guide.id })
              }
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
                color={Color.muted}
              />
            </Pressable>
          </View>
          <View style={styles.section}>
            <Label>Procedures</Label>
            <ProcedureList rows={rows} onChoose={openProcedure} />
          </View>
        </View>
      </ScrollView>
      {back}
      <View
        style={[styles.bottomBar, { paddingBottom: insets.bottom + Space.sm }]}
        // Measure the wrapped safety text so larger text never covers the final row.
        onLayout={event => setBarHeight(event.nativeEvent.layout.height)}
      >
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Color.black },
  back: { position: 'absolute', left: Space.lg },
  hero: { height: Layout.heroHeight, overflow: 'hidden' },
  // Sized explicitly: an Image from a bundled asset otherwise keeps the asset's height.
  heroImage: { width: '100%', height: '100%' },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: Layout.heroHeight * Layout.fadeFraction,
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
  summary: { ...Type.data, color: Color.muted },
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
    backgroundColor: Color.accent,
    borderColor: Color.accent,
  },
  modeTitle: { ...Type.calloutStrong, flexShrink: 1 },
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
  safetyRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  safety: { ...Type.footnote, color: Color.caution, flex: 1 },
  missing: { ...Type.callout, color: Color.muted, marginHorizontal: Space.xl },
});
