import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Label } from '../../../shared/ui/kit/Label';
import { twoDigits } from '../../../shared/ui/readout';
import { Color, HAIRLINE, Radius, Space, Type } from '../../../shared/ui/theme';
import type { Part, PartId } from '../../../domain/pack';

// Wide enough for any two digit index, so every name starts on the same line.
const INDEX_WIDTH = 24;

/**
 * Every named part of the capture, to look at one directly while exploring.
 * A part inside another sits under it, indented. Names only: the instructor below describes
 * the part picked, so its summary is not said twice.
 */
export function PartList({
  parts,
  selected,
  onSelect,
}: {
  parts: readonly Part[];
  selected: PartId | null;
  onSelect: (id: PartId) => void;
}) {
  return (
    <View testID="part-list" style={styles.list}>
      <View style={styles.header}>
        <Label>Parts</Label>
        <Label color={Color.faint}>{twoDigits(parts.length)}</Label>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.rows}>
        {parts.map((part, index) => {
          const current = part.id === selected;
          return (
            <Pressable
              key={part.id}
              testID={`part-row-${part.id}`}
              accessibilityRole="button"
              accessibilityLabel={part.name}
              accessibilityState={{ selected: current }}
              onPress={() => onSelect(part.id)}
              style={({ pressed }) => [
                styles.row,
                part.parent !== null && styles.inside,
                current && styles.rowCurrent,
                pressed && styles.rowPressed,
              ]}
            >
              <Label
                color={current ? Color.accent : Color.faint}
                style={styles.index}
              >
                {twoDigits(index + 1)}
              </Label>
              <Text numberOfLines={1} style={styles.name}>
                {part.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // As tall as its parts, up to what the sidebar gives it, like the step list it stands in for.
  list: { flexShrink: 1, gap: Space.md, paddingTop: Space.lg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Space.lg,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  rows: { gap: Space.sm, paddingHorizontal: Space.lg, paddingBottom: Space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    backgroundColor: Color.surface,
  },
  inside: { marginLeft: Space.xl },
  rowCurrent: { borderColor: Color.accent, backgroundColor: Color.accentWash },
  rowPressed: { backgroundColor: Color.pressed },
  index: { width: INDEX_WIDTH },
  name: { ...Type.calloutStrong, flex: 1, color: Color.text },
});
