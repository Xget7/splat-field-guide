import {
  Pressable,
  StyleSheet,
  Text,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LiquidGlassView } from '@sbaiahmed1/react-native-blur';
import { Icon, type IconName } from '../../ui/Icon';
import { Color, MIN_TOUCH, Radius, Space, Type } from '../../ui/theme';

interface Props {
  label?: string;
  detail?: string;
  icon?: IconName;
  accessibilityLabel: string;
  accessibilityState?: AccessibilityState;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
}

export function ARGlassButton({
  label,
  detail,
  icon,
  accessibilityLabel,
  accessibilityState,
  disabled = false,
  testID,
  style,
  onPress,
}: Props) {
  const ink = disabled ? Color.secondaryText : Color.text;
  return (
    <LiquidGlassView
      glassType="clear"
      glassTintColor="transparent"
      isInteractive={!disabled}
      reducedTransparencyFallbackColor={Color.raised}
      style={[styles.glass, style]}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ ...accessibilityState, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[styles.button, !label && styles.iconButton]}
      >
        {label && <Text style={[styles.label, { color: ink }]}>{label}</Text>}
        {detail && (
          <Text style={[styles.detail, { color: ink }]}>{detail}</Text>
        )}
        {icon && <Icon name={icon} color={ink} />}
      </Pressable>
    </LiquidGlassView>
  );
}

const styles = StyleSheet.create({
  glass: { borderRadius: Radius.round },
  button: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
  },
  iconButton: { paddingHorizontal: Space.md },
  label: { ...Type.calloutStrong, flexShrink: 1 },
  detail: { ...Type.data },
});
