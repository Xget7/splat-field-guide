import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Backdrop } from '../ui/Gradients';
import { Icon, IconName } from '../ui/Icon';
import { Label } from '../ui/Label';
import { Color, Space, Type } from '../ui/theme';

const ICON_SIZE = 20;

export function PackErrorScreen({ message }: { message: string }) {
  return (
    <SafeAreaView style={styles.root}>
      <Backdrop />
      <View style={styles.status}>
        <Icon name={IconName.warn} size={ICON_SIZE} color={Color.caution} />
        <Label color={Color.caution}>Pack error</Label>
      </View>
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
    backgroundColor: Color.surface,
    padding: Space.xl,
    gap: Space.md,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  title: { ...Type.title, color: Color.text },
  message: { ...Type.body, color: Color.secondaryText },
});
