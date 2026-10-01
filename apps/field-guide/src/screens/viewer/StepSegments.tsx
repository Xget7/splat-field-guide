import { StyleSheet, View } from 'react-native';
import { Color, Space } from '../../ui/theme';

const BAR_HEIGHT = 2;

/** One bar per step: done, current, still to come. */
export function StepSegments({
  count,
  current,
}: {
  count: number;
  /** Zero based. */
  current: number;
}) {
  return (
    <View style={styles.row} accessible={false}>
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            index < current && styles.done,
            index === current && styles.current,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Space.xs },
  bar: { flex: 1, height: BAR_HEIGHT, backgroundColor: Color.line },
  done: { backgroundColor: Color.completed },
  current: { backgroundColor: Color.accent },
});
