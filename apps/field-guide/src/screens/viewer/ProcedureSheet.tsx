import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Pack, ProcedureId } from '../../features/pack/pack';
import { Color, MIN_TOUCH, Radius, Space, Type } from '../../ui/theme';
import { procedureRowsFor } from '../../features/guide/procedureRows';
import { ProcedureList } from '../ProcedureList';

interface Props {
  visible: boolean;
  pack: Pack;
  current: ProcedureId | null;
  onChoose: (procedureId: ProcedureId) => void;
  onClose: () => void;
}

export function ProcedureSheet({
  visible,
  pack,
  current,
  onChoose,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      testID="procedure-sheet"
      visible={visible}
      presentationStyle="formSheet"
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
            paddingLeft: insets.left + Space.lg,
            paddingRight: insets.right + Space.lg,
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
          <ProcedureList
            rows={procedureRowsFor(pack)}
            current={current}
            onChoose={onChoose}
          />
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
    paddingBottom: Space.lg,
  },
  heading: { ...Type.title, color: Color.text },
  done: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: Space.sm,
    borderRadius: Radius.sm,
  },
  doneText: { ...Type.headline, color: Color.accent },
  pressed: { backgroundColor: Color.pressed },
});
