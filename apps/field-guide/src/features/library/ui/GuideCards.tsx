import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton, IconButtonVariant } from '../../../ui/Button';
import { IconName } from '../../../ui/Icon';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';
import type { ContinueRow } from '../domain/library';
const Layout = { percent: 100, playSize: G.control } as const;
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
      {row.guide.image !== undefined && (
        <Image
          source={row.guide.image}
          resizeMode="cover"
          style={styles.thumbnail}
        />
      )}
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
  continue: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: G.small,
    gap: G.small,
    borderRadius: R.control,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardPressed: { backgroundColor: C.raised },
  thumbnail: { width: 64, height: 64, borderRadius: R.control },
  continueBody: { flex: 1, gap: G.unit },
  continueTitle: { ...T.heading, color: C.text },
  step: { ...T.caption, color: C.secondary },
  track: { height: 2, backgroundColor: C.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: C.accent },
  play: { borderRadius: R.pill },
});
