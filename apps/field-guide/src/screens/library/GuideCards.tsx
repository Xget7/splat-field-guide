import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { type ComingSoonGuide, type ReadyGuide } from '../../pack/catalog';
import { IconButton, IconButtonVariant } from '../../ui/Button';
import { IconName } from '../../ui/Icon';
import { Color, Radius, Space, Type } from '../../ui/theme';
import { READOUT_SEPARATOR } from '../../ui/readout';
import type { ContinueRow } from './library';

const Layout = {
  readyAspect: 16 / 9,
  soonAspect: 3 / 2,
  soonOpacity: 0.7,
  thumbnail: 56,
  playSize: 40,
  progressHeight: 2,
  percent: 100,
} as const;

export function ReadyCard({
  guide,
  wide = false,
  onPress,
}: {
  guide: ReadyGuide;
  /** Photo and details side by side, so the card is not a screen-wide photo. */
  wide?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={`guide-card-${guide.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${guide.title}, ${guide.area}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        wide && styles.wideCard,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.readyFrame, wide && styles.wideFrame]}>
        <Image source={guide.image} resizeMode="cover" style={styles.image} />
      </View>
      <View style={[styles.readyBody, wide && styles.wideBody]}>
        <Text style={styles.readyTitle}>{guide.title}</Text>
        <Text style={styles.subtitle}>
          {[guide.subtitle, guide.area].join(READOUT_SEPARATOR)}
        </Text>
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
      </View>
      <View style={styles.soonBody}>
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
        variant={IconButtonVariant.primary}
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
  readyBody: { padding: Space.lg, gap: Space.sm },
  wideCard: { flexDirection: 'row' },
  wideFrame: { flex: 3 },
  wideBody: { flex: 2, justifyContent: 'flex-end', padding: Space.xl },
  readyTitle: { ...Type.title, color: Color.text },
  subtitle: { ...Type.footnote, color: Color.muted },
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
