import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, IconButton, IconButtonVariant, IconName } from '../../ui/kit';
import {
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Radius,
  Space,
  Type,
} from '../../ui/theme';

const CHEVRON = 16;

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
      <IconButton
        testID="viewer-back"
        icon={IconName.back}
        accessibilityLabel="Back"
        onPress={onBack}
      />
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
      <IconButton
        testID="instructor-toggle"
        icon={IconName.mic}
        accessibilityLabel="Instructor"
        accessibilityState={{ selected: instructorOpen }}
        variant={
          instructorOpen ? IconButtonVariant.active : IconButtonVariant.raised
        }
        onPress={onToggleInstructor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
    backgroundColor: Color.black,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: Color.line,
  },
  procedure: {
    flex: 1,
    height: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    backgroundColor: Color.raised,
  },
  pressed: { backgroundColor: Color.pressed },
  procedureTitle: { ...Type.calloutStrong, flexShrink: 1, color: Color.text },
});
