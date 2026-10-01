import {
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import { BUTTON_HEIGHT, Color, MIN_TOUCH, Radius, Space, Type } from '../theme';
import { Icon, type IconName } from './Icon';

export const ButtonVariant = {
  primary: 'primary',
  secondary: 'secondary',
} as const;
export type ButtonVariant = (typeof ButtonVariant)[keyof typeof ButtonVariant];

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  icon?: IconName;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = ButtonVariant.primary,
  icon,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const primary = variant === ButtonVariant.primary;
  const ink = disabled ? Color.faint : primary ? Color.accentText : Color.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      {...props}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : styles.secondary,
        pressed && (primary ? styles.primaryPressed : styles.secondaryPressed),
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon && <Icon name={icon} size={18} color={ink} />}
      <Text style={[styles.text, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

export const IconButtonVariant = {
  /** Floats over the splat. */
  overlay: 'overlay',
  /** Sits on a panel. */
  raised: 'raised',
  /** On: the instructor is listening, a mode is active. */
  active: 'active',
} as const;
export type IconButtonVariant =
  (typeof IconButtonVariant)[keyof typeof IconButtonVariant];

interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: IconName;
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  size?: number;
  style?: ViewStyle;
}

export function IconButton({
  icon,
  variant = IconButtonVariant.raised,
  size = MIN_TOUCH,
  disabled,
  style,
  ...props
}: IconButtonProps) {
  const ink = disabled
    ? Color.faint
    : variant === IconButtonVariant.active
    ? Color.accentText
    : Color.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={Math.max(0, (MIN_TOUCH - size) / 2)}
      {...props}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size },
        VARIANT_STYLE[variant],
        pressed && styles.secondaryPressed,
        pressed &&
          variant === IconButtonVariant.active &&
          styles.primaryPressed,
        style,
      ]}
    >
      <Icon name={icon} color={ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: BUTTON_HEIGHT,
    borderRadius: Radius.md,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
  },
  primary: { backgroundColor: Color.accent },
  primaryPressed: { backgroundColor: Color.accentPressed },
  secondary: {
    backgroundColor: Color.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.lineStrong,
  },
  secondaryPressed: { backgroundColor: Color.pressed },
  disabled: { backgroundColor: Color.surface, borderColor: Color.line },
  text: { ...Type.headline },
  iconButton: {
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const VARIANT_STYLE = StyleSheet.create({
  overlay: {
    backgroundColor: Color.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.lineStrong,
  },
  raised: {
    backgroundColor: Color.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.lineStrong,
  },
  active: { backgroundColor: Color.accent },
});
