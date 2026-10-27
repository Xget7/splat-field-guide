import {
  DarkTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { catalogFor } from '../../features/pack/catalog';
import { offersArCheck, offersAssembly } from '../../features/ar';
import {
  ARScreen,
  ARPlacementScreen,
  ARAssemblyScreen,
} from '../../features/ar/views';
import { GuideDetailScreen } from '../../features/guide/views';
import { LibraryScreen } from '../../features/library/views';
import { ViewerScreen } from '../../features/viewer/views';
import { BenchScreen } from '../../features/bench/views';
import { CatalogProvider } from '../context/CatalogContext';
import type { Pack } from '../../features/pack/pack';

import { Color } from '../../ui/theme';
import { LINKING } from './linking';
import { Route, type RootStackParamList } from './routes';

const Stack = createNativeStackNavigator<RootStackParamList>();

const NAVIGATION_THEME: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Color.surface,
    card: Color.surface,
    primary: Color.accent,
    text: Color.text,
    border: Color.line,
  },
};

const SCREEN_OPTIONS = {
  headerShown: false,
  contentStyle: { backgroundColor: Color.surface },
} as const;

// Orbiting drags from anywhere, so the viewer leaves by its back button, not an edge swipe.
const VIEWER_OPTIONS = { gestureEnabled: false } as const;

export function RootNavigator({ pack }: { pack: Pack }) {
  const catalog = useMemo(() => catalogFor(pack), [pack]);
  return (
    <CatalogProvider catalog={catalog}>
      <NavigationContainer theme={NAVIGATION_THEME} linking={LINKING}>
        <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
          <Stack.Screen name={Route.library} component={LibraryScreen} />
          <Stack.Screen name={Route.guide} component={GuideDetailScreen} />
          <Stack.Screen
            name={Route.viewer}
            component={ViewerScreen}
            options={VIEWER_OPTIONS}
          />
          {offersArCheck(Platform.OS) && (
            <Stack.Screen
              name={Route.ar}
              component={ARScreen}
              options={VIEWER_OPTIONS}
            />
          )}
          {offersAssembly(Platform.OS) && (
            <Stack.Screen
              name={Route.placement}
              component={ARPlacementScreen}
              options={VIEWER_OPTIONS}
            />
          )}
          {offersAssembly(Platform.OS) && (
            <Stack.Screen
              name={Route.assembly}
              component={ARAssemblyScreen}
              options={VIEWER_OPTIONS}
            />
          )}
          <Stack.Screen
            name={Route.bench}
            component={BenchScreen}
            options={VIEWER_OPTIONS}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </CatalogProvider>
  );
}
