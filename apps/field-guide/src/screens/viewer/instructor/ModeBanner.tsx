import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
} from 'react-native-reanimated';
import { Motion, Space } from '../../../ui/theme';

export const MODE_RULE_WIDTH = 2;
const ENTER = FadeIn.duration(Motion.base);
const EXIT = FadeOut.duration(Motion.base);

export function ModeBanner({
  ruleColor,
  children,
}: {
  ruleColor: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reducedMotion ? undefined : ENTER}
      exiting={reducedMotion ? undefined : EXIT}
      style={[styles.banner, { borderLeftColor: ruleColor }]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderLeftWidth: MODE_RULE_WIDTH,
    paddingLeft: Space.md,
    paddingVertical: Space.sm,
    gap: Space.xs,
  },
});
