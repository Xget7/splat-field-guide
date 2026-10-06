import { StyleSheet, View } from 'react-native';
import { Color, Space } from '../../ui/theme';

const BAR_HEIGHT = 2;

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
            index < current && styles.earlier,
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
  earlier: { backgroundColor: Color.completed },
  current: { backgroundColor: Color.accent },
});
