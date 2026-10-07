import { ProgressiveBlurView } from '@sbaiahmed1/react-native-blur';
import { StyleSheet } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Defs, LinearGradient, Rect } from 'react-native-svg';
import { fadeOutStops, SvgFill } from './Gradients';
import { Color, Space } from './theme';

const Edge = {
  // Blur radius under the status bar; it clears toward the content.
  blur: 16,
  // The tint behind the status bar text, fading out below it with the blur.
  tint: 0.9,
} as const;

/** The scroll offset of an Animated.ScrollView, read on the UI thread. */
export function useScrollOffset() {
  const offset = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler(event => {
    offset.value = event.contentOffset.y;
  });
  return { offset, onScroll };
}

/**
 * Blurs and darkens content that scrolls under the status bar.
 * It shows only once content reaches the bar, so the backdrop stays untouched at rest.
 */
export function ScrollEdge({ offset }: { offset: SharedValue<number> }) {
  const insets = useSafeAreaInsets();
  const height = insets.top + Space.xl;
  // Both hold at full strength behind the status bar text.
  const plateau = insets.top / height;
  const reveal = useAnimatedStyle(() => ({
    opacity: interpolate(
      offset.value,
      [0, height],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.edge, { height }, reveal]}
    >
      <ProgressiveBlurView
        blurType="dark"
        blurAmount={Edge.blur}
        direction="blurredTopClearBottom"
        startOffset={plateau}
        style={StyleSheet.absoluteFill}
      />
      <SvgFill>
        {size => (
          <>
            <Defs>
              <LinearGradient id="scroll-edge" x1="0" y1="0" x2="0" y2="1">
                {fadeOutStops(Color.canvasTop, plateau, Edge.tint)}
              </LinearGradient>
            </Defs>
            <Rect {...size} fill="url(#scroll-edge)" />
          </>
        )}
      </SvgFill>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', top: 0, left: 0, right: 0 },
});
