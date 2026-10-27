import { useEffect, useState } from 'react';

import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './navigation/RootNavigator';
import { bundledPack } from '../features/pack/bundledPack';
import { PackErrorScreen } from './startup/PackErrorScreen';
import { Color } from '../ui/theme';
import { createAppInstructor } from './startup';

function App() {
  // Created during the first render, so screens below already find it in the store.
  const [instructor] = useState(createAppInstructor);
  useEffect(() => {
    instructor.start();
    return () => instructor.stop();
  }, [instructor]);
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
  root: { flex: 1, backgroundColor: Color.surface },
});

export default App;
