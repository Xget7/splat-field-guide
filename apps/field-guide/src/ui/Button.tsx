import {
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import {
  BUTTON_HEIGHT,
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Radius,
  Space,
  Type,
} from './theme';
import { SheenEdge } from './Gradients';
import { Icon, type IconName } from './Icon';

const BUTTON_ICON_SIZE = 18;
const SHEEN_ID = 'button-sheen';

export const ButtonVariant = {
  primary: 'primary',
  secondary: 'secondary',
  quiet: 'quiet',
} as const;
export type ButtonVariant = (typeof ButtonVariant)[keyof typeof ButtonVariant];

const BUTTON_INK = {
  primary: Color.actionText,
  secondary: Color.text,
  quiet: Color.secondaryText,
} as const satisfies Record<ButtonVariant, string>;

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
  const quiet = variant === ButtonVariant.quiet;
  const ink = disabled ? Color.faint : BUTTON_INK[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      {...props}
      style={({ pressed }) => [
        styles.button,
        BUTTON_STYLE[variant],
        pressed && BUTTON_PRESSED_STYLE[variant],
        disabled && !quiet && styles.disabled,
        style,
      ]}
    >
      {({ pressed }) => (
        <>
          {!quiet && icon && (
            <Icon name={icon} size={BUTTON_ICON_SIZE} color={ink} />
          )}
          <Text
            style={[
              styles.text,
              { color: ink },
              quiet && styles.quietText,
              quiet && pressed && styles.quietTextPressed,
              disabled && styles.disabledText,
            ]}
          >
            {label}
          </Text>
          {variant === ButtonVariant.primary && !disabled && (
            <SheenEdge id={SHEEN_ID} radius={Radius.round} />
          )}
        </>
      )}
    </Pressable>
  );
}

export const IconButtonVariant = {
  overlay: 'overlay',
  raised: 'raised',
  active: 'active',
  primary: 'primary',
} as const;
export type IconButtonVariant =
  (typeof IconButtonVariant)[keyof typeof IconButtonVariant];

const ICON_BUTTON_INK = {
  overlay: Color.text,
  raised: Color.text,
  active: Color.accentText,
  primary: Color.actionText,
} as const satisfies Record<IconButtonVariant, string>;

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
  const ink = disabled ? Color.faint : ICON_BUTTON_INK[variant];
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
        pressed && variant === IconButtonVariant.active && styles.activePressed,
        pressed &&
          variant === IconButtonVariant.primary &&
          styles.primaryPressed,
        disabled && styles.disabled,
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
    borderRadius: Radius.round,
    paddingHorizontal: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
  },
  primary: { backgroundColor: Color.action },
  primaryPressed: { backgroundColor: Color.actionPressed },
  // Keep secondary actions outlined so the filled action identifies the way forward.
  secondary: {
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
  },
  secondaryPressed: { backgroundColor: Color.pressed },
  activePressed: { backgroundColor: Color.accentPressed },
  disabled: { backgroundColor: Color.surface, borderColor: Color.line },
  text: { ...Type.headline },
  quiet: {
    height: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: Space.sm,
  },
  quietText: { ...Type.label, color: Color.secondaryText },
  quietTextPressed: { color: Color.text },
  disabledText: { color: Color.faint },
  iconButton: {
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const BUTTON_STYLE = {
  primary: styles.primary,
  secondary: styles.secondary,
  quiet: styles.quiet,
} as const;
const BUTTON_PRESSED_STYLE = {
  primary: styles.primaryPressed,
  secondary: styles.secondaryPressed,
  quiet: undefined,
} as const;

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
  active: { backgroundColor: Color.accentFill },
  primary: { backgroundColor: Color.action },
});
