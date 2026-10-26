import { useEffect } from 'react';
import { InstructorRuntimeContext } from './app/context/InstructorRuntimeContext';
import { createInstructorRuntime } from './features/instructor/runtime/instructorRuntime';
import { StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './app/navigation/RootNavigator';
import { bundledPack } from './features/pack/bundledPack';
import { PackErrorScreen } from './screens/pack-error/PackErrorScreen';
import { Color } from './ui/theme';

const instructorRuntime = createInstructorRuntime();

function App() {
  useEffect(() => {
    instructorRuntime.start();
  }, []);
  return (
    <InstructorRuntimeContext.Provider value={instructorRuntime}>
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
    </InstructorRuntimeContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.surface },
});

export default App;
