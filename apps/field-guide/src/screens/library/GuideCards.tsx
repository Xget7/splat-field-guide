import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  type ComingSoonGuide,
  type ReadyGuide,
} from '../../features/pack/catalog';
import { IconButton, IconButtonVariant } from '../../ui/Button';
import { ModelPreview, Turns } from '../../features/viewport/ModelPreview';
import { Scrim, SheenEdge, Spotlight } from '../../ui/Gradients';
import { Icon, IconName } from '../../ui/Icon';
import { Color, HAIRLINE, Radius, Space, Type } from '../../ui/theme';
import { READOUT_SEPARATOR } from '../../ui/readout';
import { factsFor, type ContinueRow } from './library';

const Layout = {
  heroAspect: 1,
  heroWideAspect: 2.6,
  heroFadeFrom: 0.15,
  // The frame shows as a thin bezel around the stage.
  frameInset: 6,
  soonAspect: 1,
  soonWideAspect: 4 / 3,
  soonFadeFrom: 0.25,
  soonImageOpacity: 0.55,
  thumbnail: 64,
  playSize: 44,
  progressHeight: 3,
  percent: 100,
  ctaHeight: 44,
  ctaIcon: 18,
  chipHeight: 26,
} as const;

export function ReadyCard({
  guide,
  wide = false,
  onPress,
}: {
  guide: ReadyGuide;
  wide?: boolean;
  onPress: () => void;
}) {
  // The model turns between the facts and the title, clear of both.
  const [bodyHeight, setBodyHeight] = useState(0);
  return (
    <Pressable
      testID={`guide-card-${guide.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${guide.title}, ${guide.area}`}
      onPress={onPress}
      style={({ pressed }) => [styles.frame, pressed && styles.framePressed]}
    >
      <View
        style={[
          styles.photo,
          {
            aspectRatio: wide ? Layout.heroWideAspect : Layout.heroAspect,
          },
        ]}
      >
        <View style={[styles.stage, { bottom: bodyHeight }]}>
          <Spotlight id={`stage-${guide.id}`} />
        </View>
        <ModelPreview
          path={guide.model}
          turn={Turns.sway}
          style={[styles.stage, { bottom: bodyHeight }]}
          fallback={
            <>
              <Image
                source={guide.image}
                resizeMode="cover"
                style={styles.cover}
              />
              <Scrim id={`hero-${guide.id}`} start={Layout.heroFadeFrom} />
            </>
          }
        />
        <View style={styles.facts}>
          {factsFor(guide).map(fact => (
            <View key={fact} style={styles.chip}>
              <Text style={styles.chipText}>{fact}</Text>
            </View>
          ))}
        </View>
        <View
          style={[styles.heroBody, wide && styles.heroBodyWide]}
          onLayout={event => setBodyHeight(event.nativeEvent.layout.height)}
        >
          <View style={styles.heroText}>
            <Text style={wide ? styles.heroTitleWide : styles.heroTitle}>
              {guide.title}
            </Text>
            <Text style={styles.heroSubtitle}>
              {[guide.subtitle, guide.area].join(READOUT_SEPARATOR)}
            </Text>
          </View>
          <OpenCue id={`open-${guide.id}`} label="Open guide" />
        </View>
      </View>
    </Pressable>
  );
}

/** The card's call to action: drawn as a button, pressed through the card. */
function OpenCue({ id, label }: { id: string; label: string }) {
  return (
    <View style={styles.cue}>
      <Text style={styles.cueText}>{label}</Text>
      <Icon
        name={IconName.next}
        size={Layout.ctaIcon}
        color={Color.actionText}
      />
      <SheenEdge id={id} radius={Radius.round} />
    </View>
  );
}

export function SoonCard({
  guide,
  wide = false,
}: {
  guide: ComingSoonGuide;
  wide?: boolean;
}) {
  return (
    <View
      testID={`soon-card-${guide.id}`}
      accessible
      accessibilityLabel={`${guide.title}, ${guide.area}, coming soon`}
      style={[
        styles.soonCard,
        { aspectRatio: wide ? Layout.soonWideAspect : Layout.soonAspect },
      ]}
    >
      <Image
        source={guide.image}
        resizeMode="cover"
        style={[styles.cover, styles.soonImage]}
      />
      <Scrim id={`soon-${guide.id}`} start={Layout.soonFadeFrom} />
      <View style={styles.soonBody}>
        <Text style={styles.soonTitle}>{guide.title}</Text>
        <Text style={styles.soonArea}>{guide.area}</Text>
      </View>
    </View>
  );
}

export function ContinueCard({
  row,
  onPress,
}: {
  row: ContinueRow;
  onPress: () => void;
}) {
  const label = `Continue ${row.procedure.title}, ${row.stepLabel}`;
  return (
    <Pressable
      testID="library-continue"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.continue, pressed && styles.cardPressed]}
    >
      <Image
        source={row.guide.image}
        resizeMode="cover"
        style={styles.thumbnail}
      />
      <View style={styles.continueBody}>
        <Text style={styles.continueTitle}>{row.procedure.title}</Text>
        <Text style={styles.step}>{row.stepLabel}</Text>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${row.fraction * Layout.percent}%` },
            ]}
          />
        </View>
      </View>
      <IconButton
        icon={IconName.play}
        size={Layout.playSize}
        variant={IconButtonVariant.primary}
        accessibilityLabel={label}
        onPress={onPress}
        style={styles.play}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    padding: Layout.frameInset,
    borderRadius: Radius.frame,
    backgroundColor: Color.raised,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
  },
  framePressed: { backgroundColor: Color.pressed },
  // Bundled images keep their asset size unless the style sets both dimensions.
  cover: { position: 'absolute', width: '100%', height: '100%' },
  photo: {
    borderRadius: Radius.frame - Layout.frameInset,
    overflow: 'hidden',
  },
  stage: {
    position: 'absolute',
    top: Space.md + Layout.chipHeight + Space.sm,
    left: 0,
    right: 0,
  },
  facts: {
    position: 'absolute',
    top: Space.md,
    left: Space.md,
    flexDirection: 'row',
    gap: Space.xs,
  },
  chip: {
    height: Layout.chipHeight,
    justifyContent: 'center',
    paddingHorizontal: Space.sm + Space.xxs,
    borderRadius: Radius.round,
    backgroundColor: Color.chip,
    borderWidth: HAIRLINE,
    borderColor: Color.glassLine,
  },
  chipText: { ...Type.footnote, color: Color.secondaryText },
  heroBody: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: Space.lg,
    gap: Space.md,
    alignItems: 'flex-start',
  },
  heroBodyWide: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    padding: Space.xl,
  },
  heroText: { gap: Space.xs, flexShrink: 1 },
  heroTitle: { ...Type.title, color: Color.text },
  heroTitleWide: { ...Type.largeTitle, color: Color.text },
  heroSubtitle: { ...Type.callout, color: Color.secondaryText },
  cue: {
    height: Layout.ctaHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingLeft: Space.lg + Space.xxs,
    paddingRight: Space.md,
    borderRadius: Radius.round,
    backgroundColor: Color.action,
  },
  cueText: { ...Type.calloutStrong, color: Color.actionText },
  soonCard: {
    flex: 1,
    borderRadius: Radius.card,
    overflow: 'hidden',
    backgroundColor: Color.raised,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
  },
  soonImage: { opacity: Layout.soonImageOpacity },
  soonBody: {
    position: 'absolute',
    left: Space.md,
    right: Space.md,
    bottom: Space.md,
    gap: Space.xxs,
  },
  soonTitle: { ...Type.calloutStrong, color: Color.secondaryText },
  soonArea: { ...Type.footnote, color: Color.muted },
  continue: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Space.md,
    gap: Space.md,
    borderRadius: Radius.frame - Layout.frameInset,
    backgroundColor: Color.raised,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
  },
  cardPressed: { backgroundColor: Color.pressed },
  thumbnail: {
    width: Layout.thumbnail,
    height: Layout.thumbnail,
    borderRadius: Radius.control,
  },
  continueBody: { flex: 1, gap: Space.xs },
  continueTitle: { ...Type.headline, color: Color.text },
  step: { ...Type.data, color: Color.muted },
  track: {
    height: Layout.progressHeight,
    borderRadius: Radius.round,
    backgroundColor: Color.line,
    marginTop: Space.xs,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: Color.accent },
  play: { borderRadius: Radius.round },
});
