import { Pressable, StyleSheet, Text } from 'react-native';
import { Color, FontSize, Space } from './theme';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  fillRow?: boolean;
  testID?: string;
}

export function GuideButton({
  label,
  onPress,
  disabled = false,
  primary = false,
  fillRow = false,
  testID,
}: Props) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        fillRow && styles.fillRow,
        primary && styles.primary,
        primary && pressed && styles.primaryPressed,
        !primary && pressed && styles.secondaryPressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, primary && styles.primaryLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    backgroundColor: Color.secondary,
  },
  fillRow: { flex: 1 },
  primary: { backgroundColor: Color.accent },
  primaryPressed: { backgroundColor: Color.accentPressed },
  secondaryPressed: { backgroundColor: Color.border },
  disabled: { opacity: 0.4 },
  label: {
    color: Color.text,
    fontSize: FontSize.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  primaryLabel: { color: Color.accentText },
});
