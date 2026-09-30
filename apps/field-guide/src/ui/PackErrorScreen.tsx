import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Color, FontSize, Space } from './theme';

export function PackErrorScreen({ message }: { message: string }) {
  return (
    <SafeAreaView style={styles.root}>
      <Text accessibilityRole="header" style={styles.title}>
        Unable to open the guide
      </Text>
      <Text
        testID="pack-error"
        accessibilityRole="alert"
        style={styles.message}
      >
        {message}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: Color.black,
    padding: Space.xl,
    gap: Space.lg,
  },
  title: { color: Color.text, fontSize: FontSize.title, fontWeight: '700' },
  message: { color: Color.text, fontSize: FontSize.body },
});
