import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, IconName } from '../../ui/Icon';
import {
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Radius,
  Space,
  Type,
} from '../../ui/theme';

const CHEVRON = 14;

interface Props {
  topInset: number;
  procedureTitle: string;
  instructorOpen: boolean;
  onBack: () => void;
  onChooseProcedure: () => void;
  onToggleInstructor: () => void;
}

/** Opaque, so a framing never puts a part under a control. */
export function ViewerTopBar({
  topInset,
  procedureTitle,
  instructorOpen,
  onBack,
  onChooseProcedure,
  onToggleInstructor,
}: Props) {
  return (
    <View style={[styles.bar, { paddingTop: topInset + Space.xs }]}>
      <Pressable
        testID="viewer-back"
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      >
        <Icon name={IconName.back} />
      </Pressable>
      <Pressable
        testID="procedure-button"
        accessibilityRole="button"
        accessibilityLabel={`Procedure: ${procedureTitle}`}
        accessibilityHint="Choose another procedure"
        onPress={onChooseProcedure}
        style={({ pressed }) => [styles.procedure, pressed && styles.pressed]}
      >
        <Text numberOfLines={1} style={styles.procedureTitle}>
          {procedureTitle}
        </Text>
        <Icon name={IconName.down} size={CHEVRON} color={Color.muted} />
      </Pressable>
      <Pressable
        testID="instructor-toggle"
        accessibilityRole="button"
        accessibilityLabel="Instructor"
        accessibilityHint={
          instructorOpen ? 'Switch to self-guided mode' : 'Open the instructor'
        }
        accessibilityState={{ selected: instructorOpen }}
        onPress={onToggleInstructor}
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      >
        <Icon
          name={IconName.chat}
          color={instructorOpen ? Color.accent : Color.muted}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
    backgroundColor: Color.drawer,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: Color.line,
  },
  control: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.round,
  },
  procedure: {
    flex: 1,
    height: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    borderRadius: Radius.round,
  },
  pressed: { backgroundColor: Color.pressed },
  procedureTitle: { ...Type.calloutStrong, flexShrink: 1, color: Color.text },
});
