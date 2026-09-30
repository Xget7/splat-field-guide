import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Color, FontSize, Space } from './theme';

interface Props {
  procedureTitle: string;
  onChooseProcedure: () => void;
  stepNumber: number;
  stepCount: number;
}

export function StepProgress({
  procedureTitle,
  onChooseProcedure,
  stepNumber,
  stepCount,
}: Props) {
  const counter =
    stepCount > 0 ? `${stepNumber} of ${stepCount}` : 'Explore the parts';
  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <Pressable
          testID="procedure-button"
          accessibilityRole="button"
          accessibilityLabel={`Procedure: ${procedureTitle}`}
          accessibilityHint="Choose what to walk through"
          onPress={onChooseProcedure}
          style={({ pressed }) => [
            styles.procedureButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.procedureTitle}>{procedureTitle}</Text>
          <View accessible={false} style={styles.chevron} />
        </Pressable>
        <Text
          testID="guide-counter"
          accessibilityLabel={stepCount > 0 ? `Step ${counter}` : counter}
          accessibilityLiveRegion="polite"
          style={styles.counter}
        >
          {counter}
        </Text>
      </View>
      <View
        style={styles.segments}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: stepCount }, (_, index) => (
          <View
            key={index}
            style={[
              styles.segment,
              index < stepNumber - 1 && styles.completed,
              index === stepNumber - 1 && styles.current,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Space.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  procedureButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: Space.xxl + Space.md,
    gap: Space.sm,
    borderRadius: Space.xs,
  },
  pressed: { backgroundColor: Color.secondary },
  procedureTitle: {
    flexShrink: 1,
    color: Color.text,
    fontSize: FontSize.small,
    fontWeight: '600',
  },
  chevron: {
    width: Space.sm,
    height: Space.sm,
    borderRightWidth: Space.xs / 2,
    borderBottomWidth: Space.xs / 2,
    borderColor: Color.muted,
    transform: [{ rotate: '45deg' }],
  },
  counter: {
    color: Color.muted,
    fontSize: FontSize.small,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  segments: { flexDirection: 'row', gap: Space.xs },
  segment: {
    flex: 1,
    height: Space.xs,
    borderRadius: Space.xs,
    backgroundColor: Color.border,
  },
  completed: { backgroundColor: Color.completed },
  current: { backgroundColor: Color.accent },
});
