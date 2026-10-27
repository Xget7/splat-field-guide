import { useLayoutEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Motion } from './theme';

const FadeOpacity = { hidden: 0, visible: 1 } as const;

/** Fades its content in each time the key changes, and takes no space when empty. */
export function ContentFade({
  contentKey,
  children,
  style,
}: {
  contentKey: string | number | null;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  const hasContent = children != null && typeof children !== 'boolean';
  const opacity = useSharedValue<number>(FadeOpacity.hidden);
  const fadingKey = useSharedValue(contentKey);
  useLayoutEffect(() => {
    cancelAnimation(opacity);
    opacity.value = FadeOpacity.hidden;
    fadingKey.value = contentKey;
    if (hasContent) {
      opacity.value = reducedMotion
        ? FadeOpacity.visible
        : withTiming(FadeOpacity.visible, {
            duration: Motion.fast,
            easing: Easing.out(Easing.exp),
          });
    }
    return () => cancelAnimation(opacity);
  }, [contentKey, hasContent, reducedMotion, opacity, fadingKey]);
  // A replacement cannot inherit the previous content's animated opacity.
  const fade = useAnimatedStyle(() => ({
    opacity: reducedMotion
      ? FadeOpacity.visible
      : fadingKey.value === contentKey
      ? opacity.value
      : FadeOpacity.hidden,
  }));
  return !hasContent ? null : (
    <Animated.View style={[style, fade]}>{children}</Animated.View>
  );
}
