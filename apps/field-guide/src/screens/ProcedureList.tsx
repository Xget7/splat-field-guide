import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProcedureId } from '../pack/pack';
import { Icon, IconName } from '../ui/Icon';
import { Color, HAIRLINE, Radius, Space, Type } from '../ui/theme';
import type { ProcedureRow } from '../guide/procedureRows';

const TRAILING_ICON = 20;

interface Props {
  rows: readonly ProcedureRow[];
  /** The running procedure, ticked. Left out where every row opens one, so each gets a chevron. */
  current?: ProcedureId | null;
  onChoose: (procedureId: ProcedureId) => void;
}

/**
 * The procedures, each with its step count. Safety notes are left to the steps that carry
 * them and to screen readers: a badge on nearly every row would only say "careful" in amber.
 */
export function ProcedureList({ rows, current, onChoose }: Props) {
  const choosing = current !== undefined;
  return (
    <View style={styles.list}>
      {rows.map((row, index) => {
        const selected = row.id === current;
        return (
          <Pressable
            key={row.id}
            testID={`procedure-row-${row.id}`}
            accessibilityRole="button"
            accessibilityLabel={row.accessibilityLabel}
            accessibilityState={choosing ? { selected } : undefined}
            onPress={() => onChoose(row.id)}
            style={({ pressed }) => [
              styles.row,
              index > 0 && styles.divided,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.body}>
              <Text style={[styles.title, selected && styles.selectedTitle]}>
                {row.title}
              </Text>
              <Text style={styles.steps}>{row.stepsLabel}</Text>
            </View>
            {!choosing ? (
              <Icon
                name={IconName.next}
                size={TRAILING_ICON}
                color={Color.faint}
              />
            ) : selected ? (
              <Icon
                name={IconName.check}
                size={TRAILING_ICON}
                color={Color.accent}
              />
            ) : (
              <View style={styles.trailingSpace} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  divided: { borderTopWidth: HAIRLINE, borderTopColor: Color.line },
  pressed: { backgroundColor: Color.pressed },
  body: { flex: 1, gap: Space.xs },
  title: { ...Type.callout, color: Color.text },
  selectedTitle: { ...Type.calloutStrong, color: Color.accent },
  steps: { ...Type.data, color: Color.muted },
  trailingSpace: { width: TRAILING_ICON },
});
