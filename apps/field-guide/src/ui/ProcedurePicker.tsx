import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProcedureId } from '../domain/pack';
import type { ProcedureRow } from './guideContent';
import { Color, FontSize, Space } from './theme';

interface Props {
  visible: boolean;
  rows: readonly ProcedureRow[];
  onChoose: (procedureId: ProcedureId) => void;
  onClose: () => void;
}

export function ProcedurePicker({ visible, rows, onChoose, onClose }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      testID="procedure-sheet"
      visible={visible}
      presentationStyle="pageSheet"
      animationType="slide"
      backdropColor={Color.surface}
      allowSwipeDismissal
      // Native swipe dismissal must also clear the controlled visible state.
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.surface,
          {
            paddingLeft: insets.left + Space.xl,
            paddingRight: insets.right + Space.xl,
            paddingBottom: insets.bottom + Space.lg,
          },
        ]}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.heading}>
            Procedures
          </Text>
          <Pressable
            testID="procedure-done"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.done, pressed && styles.pressed]}
          >
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
        <ScrollView>
          {rows.map(row => (
            <Pressable
              key={row.id}
              testID={`procedure-row-${row.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: row.current }}
              onPress={() => onChoose(row.id)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.rowText}>
                <Text
                  style={[styles.title, row.current && styles.currentTitle]}
                >
                  {row.title}
                </Text>
                <Text style={styles.stepCount}>{row.stepCountLabel}</Text>
              </View>
              {row.current && <View accessible={false} style={styles.check} />}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, backgroundColor: Color.surface, paddingTop: Space.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingBottom: Space.md,
  },
  heading: { color: Color.text, fontSize: FontSize.title, fontWeight: '700' },
  done: {
    minHeight: Space.xxl + Space.md,
    justifyContent: 'center',
    paddingHorizontal: Space.sm,
    borderRadius: Space.xs,
  },
  doneText: { color: Color.accent, fontSize: FontSize.body, fontWeight: '600' },
  row: {
    minHeight: Space.xxl + Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
    paddingVertical: Space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Color.border,
  },
  pressed: { backgroundColor: Color.secondary },
  rowText: { flex: 1, gap: Space.xs },
  title: { color: Color.text, fontSize: FontSize.body, fontWeight: '600' },
  currentTitle: { color: Color.accent },
  stepCount: { color: Color.muted, fontSize: FontSize.small },
  check: {
    width: Space.sm,
    height: Space.lg,
    marginHorizontal: Space.xs,
    borderRightWidth: Space.xs / 2,
    borderBottomWidth: Space.xs / 2,
    borderColor: Color.accent,
    transform: [{ rotate: '45deg' }],
  },
});
