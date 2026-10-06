import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SectionHeader } from '../../ui/SectionHeader';
import { Color, HAIRLINE, Radius, Space, Type } from '../../ui/theme';
import type { Part, PartId } from '../../features/pack/pack';

/** Show names only because the instructor already describes the picked part. */
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
      <SectionHeader title="Parts" style={styles.header} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.rows}>
        {parts.map(part => {
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
  list: { flexShrink: 1, gap: Space.md, paddingTop: Space.lg },
  header: { paddingHorizontal: Space.lg },
  scroll: { flexGrow: 0, flexShrink: 1 },
  rows: { gap: Space.sm, paddingHorizontal: Space.lg, paddingBottom: Space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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
  name: { ...Type.callout, flex: 1, color: Color.text },
});
