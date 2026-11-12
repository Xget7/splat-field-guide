import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { Icon, type IconName } from '../../../ui/Icon';
import {
  CourseColor as C,
  CourseRadius as R,
  CourseType as T,
  Grid as G,
} from '../../../ui/courseTokens';

// The shared Button draws the viewer's round controls; the course screen follows the library's
// squared course tokens instead, so it keeps its own controls rather than restyling every screen.

type ControlProps = Omit<PressableProps, 'style' | 'children'>;

/** The filled course action, drawn like the library's download action. */
export function CourseButton({
  label,
  ...props
}: ControlProps & { readonly label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...props}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export const CourseIconSurface = {
  /** On the page, such as the back button. */
  raised: 'raised',
  /** Over the 3D preview, which shows through. */
  overlay: 'overlay',
} as const;
export type CourseIconSurface =
  (typeof CourseIconSurface)[keyof typeof CourseIconSurface];

/** A square icon control with the course control corners. */
export function CourseIconButton({
  icon,
  accessibilityLabel,
  surface = CourseIconSurface.raised,
  ...props
}: ControlProps & {
  readonly icon: IconName;
  readonly accessibilityLabel: string;
  readonly surface?: CourseIconSurface;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...props}
      style={({ pressed }) => [
        styles.icon,
        SURFACE[surface],
        pressed && styles.iconPressed,
      ]}
    >
      <Icon name={icon} color={C.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: G.control,
    paddingHorizontal: G.small,
    flexDirection: 'row',
    gap: G.unit,
    borderRadius: R.control,
    backgroundColor: C.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonPressed: { backgroundColor: C.primaryPressed },
  label: { ...T.label, color: C.white },
  icon: {
    width: G.control,
    height: G.control,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: { backgroundColor: C.surface },
});

const SURFACE = StyleSheet.create({
  raised: { backgroundColor: C.raised },
  overlay: { backgroundColor: C.overlay },
});
