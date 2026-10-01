import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CATEGORY_TITLE,
  packFacts,
  type ComingSoonGuide,
  type ReadyGuide,
} from '../../../modules/catalog/catalog';
import { Brackets } from '../../../shared/ui/kit/Brackets';
import { IconButton, IconButtonVariant } from '../../../shared/ui/kit/Button';
import { Icon, IconName } from '../../../shared/ui/kit/Icon';
import { Label } from '../../../shared/ui/kit/Label';
import { Color, Radius, Space, Type } from '../../../shared/ui/theme';
import type { ContinueRow } from '../model/library';

const Layout = {
  readyAspect: 16 / 9,
  soonAspect: 3 / 2,
  soonOpacity: 0.7,
  titleSize: 19,
  thumbnail: 56,
  playSize: 40,
  progressHeight: 2,
  offlineIcon: 14,
  soonIcon: 12,
  bracketLength: 16,
  percent: 100,
} as const;

export function ReadyCard({
  guide,
  onPress,
}: {
  guide: ReadyGuide;
  onPress: () => void;
}) {
  const facts = packFacts(guide.pack);
  return (
    <Pressable
      testID={`guide-card-${guide.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${guide.title}, ${guide.area}, offline`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.readyFrame}>
        <Image source={guide.image} resizeMode="cover" style={styles.image} />
        <Brackets
          color={Color.accent}
          length={Layout.bracketLength}
          style={styles.brackets}
        />
        <View style={styles.tag}>
          <Icon
            name={IconName.check}
            size={Layout.offlineIcon}
            color={Color.accent}
          />
          <Label color={Color.accent}>Offline</Label>
        </View>
      </View>
      <View style={styles.readyBody}>
        <Text style={styles.readyTitle}>{guide.title}</Text>
        <Text
          style={styles.subtitle}
        >{`${guide.subtitle} - ${guide.area}`}</Text>
        <View style={styles.facts}>
          {[`${facts.splats} splats`, `${facts.parts} parts`, facts.size].map(
            fact => (
              <Text key={fact} style={styles.fact}>
                {fact}
              </Text>
            ),
          )}
        </View>
      </View>
    </Pressable>
  );
}

export function SoonCard({ guide }: { guide: ComingSoonGuide }) {
  return (
    <View
      testID={`soon-card-${guide.id}`}
      accessible
      accessibilityLabel={`${guide.title}, ${guide.area}, coming soon`}
      style={[styles.card, styles.soonCard]}
    >
      <View style={styles.soonFrame}>
        <Image
          source={guide.image}
          resizeMode="cover"
          style={[styles.image, styles.dimmed]}
        />
        <View style={styles.tag}>
          <Icon
            name={IconName.lock}
            size={Layout.soonIcon}
            color={Color.secondaryText}
          />
          <Label color={Color.secondaryText}>Soon</Label>
        </View>
      </View>
      <View style={styles.soonBody}>
        <Label color={Color.faint}>{CATEGORY_TITLE[guide.category]}</Label>
        <Text style={styles.soonTitle}>{guide.title}</Text>
        <Text style={styles.area}>{guide.area}</Text>
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
      style={({ pressed }) => [
        styles.card,
        styles.continue,
        pressed && styles.pressed,
      ]}
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
        variant={IconButtonVariant.active}
        accessibilityLabel={label}
        onPress={onPress}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Color.surface,
    borderColor: Color.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: Color.pressed },
  // The frame sets the shape: an Image sized by a bundled asset keeps the asset's height.
  readyFrame: { aspectRatio: Layout.readyAspect },
  soonFrame: { aspectRatio: Layout.soonAspect },
  image: { width: '100%', height: '100%' },
  dimmed: { opacity: Layout.soonOpacity },
  brackets: {
    top: Space.md,
    left: Space.md,
    right: Space.md,
    bottom: Space.md,
  },
  tag: {
    position: 'absolute',
    top: Space.md,
    left: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    backgroundColor: Color.overlay,
    borderRadius: Radius.sm,
    paddingVertical: Space.xs,
    paddingHorizontal: Space.sm,
  },
  readyBody: { padding: Space.lg, gap: Space.sm },
  readyTitle: {
    ...Type.headline,
    fontSize: Layout.titleSize,
    color: Color.text,
  },
  subtitle: { ...Type.footnote, color: Color.muted },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Space.lg },
  fact: { ...Type.data, color: Color.faint },
  soonCard: { flex: 1 },
  soonBody: { padding: Space.md, gap: Space.xs },
  soonTitle: { ...Type.calloutStrong, color: Color.secondaryText },
  area: { ...Type.footnote, color: Color.faint },
  continue: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Space.md,
    gap: Space.md,
  },
  thumbnail: {
    width: Layout.thumbnail,
    height: Layout.thumbnail,
    borderRadius: Radius.sm,
  },
  continueBody: { flex: 1, gap: Space.xs },
  continueTitle: { ...Type.headline, color: Color.text },
  step: { ...Type.data, color: Color.muted },
  track: {
    height: Layout.progressHeight,
    backgroundColor: Color.line,
    marginTop: Space.xs,
  },
  fill: { height: '100%', backgroundColor: Color.accent },
});
