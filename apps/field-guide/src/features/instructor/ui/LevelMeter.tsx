import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { Color } from '../../../ui/theme';
import { Meter, meterHeightsFor } from '../domain/voice/speechPresentation';

interface MeterProps {
  level: SharedValue<number>;
}

function MeterBar({ level, index }: MeterProps & { index: number }) {
  const style = useAnimatedStyle(() => ({
    height: meterHeightsFor(level.value)[index],
  }));
  return (
    <Animated.View
      testID={`instructor-meter-bar-${index}`}
      style={[styles.bar, style]}
    />
  );
}

export function LevelMeter({ level }: MeterProps) {
  return (
    <View testID="instructor-meter" accessible={false} style={styles.meter}>
      {Meter.weights.map((_, index) => (
        <MeterBar key={index} index={index} level={level} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  meter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Meter.gap,
    height: Meter.maxHeight,
  },
  bar: {
    width: Meter.width,
    backgroundColor: Color.accent,
    borderRadius: Meter.radius,
  },
});
