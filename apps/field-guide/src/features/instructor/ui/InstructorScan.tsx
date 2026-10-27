import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Color, Motion } from '../../../ui/theme';

const SCAN_SHARE = 1 / 3;
const SCAN_WIDTH = '33.333333%';
const SCAN_HEIGHT = 2;
const LOOP_FOREVER = -1;

export function InstructorScan({
  active,
  reducedMotion,
}: {
  active: boolean;
  reducedMotion: boolean;
}) {
  const progress = useSharedValue(0);
  const width = useSharedValue(0);
  useEffect(() => {
    if (active && !reducedMotion) {
      progress.value = 0;
      progress.value = withRepeat(
        withTiming(1, {
          duration: Motion.scanPeriod,
          easing: Easing.inOut(Easing.ease),
        }),
        LOOP_FOREVER,
      );
    } else {
      cancelAnimation(progress);
      progress.value = 0;
    }
    return () => cancelAnimation(progress);
  }, [active, reducedMotion, progress]);
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          progress.value * width.value * (1 + SCAN_SHARE) -
          width.value * SCAN_SHARE,
      },
    ],
  }));
  if (!active) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      testID="instructor-scan"
      style={styles.scanTrack}
      onLayout={event => {
        width.value = event.nativeEvent.layout.width;
      }}
    >
      {reducedMotion ? (
        <View testID="instructor-scan-static" style={styles.staticScan} />
      ) : (
        <Animated.View
          testID="instructor-scan-sweep"
          style={[styles.sweep, style]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scanTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCAN_HEIGHT,
    overflow: 'hidden',
  },
  sweep: {
    width: SCAN_WIDTH,
    height: SCAN_HEIGHT,
    backgroundColor: Color.accent,
  },
  staticScan: { height: SCAN_HEIGHT, backgroundColor: Color.accent },
});
