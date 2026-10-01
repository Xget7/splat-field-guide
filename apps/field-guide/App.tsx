import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { bundledPack } from './src/packs/bundledPack';
import { PackErrorScreen } from './src/ui/PackErrorScreen';
import { Color } from './src/ui/theme';

function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        {bundledPack.ok ? (
          <RootNavigator pack={bundledPack.pack} />
        ) : (
          <PackErrorScreen message={bundledPack.error.message} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.black },
});

export default App;
