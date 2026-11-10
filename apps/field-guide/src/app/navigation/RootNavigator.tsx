import {
  DarkTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { catalogFor } from '../../features/pack/catalog';
import type { Pack } from '../../features/pack/pack';
import type { ProgressStorage } from '../../features/guide';

import { Color } from '../../ui/theme';
import {
  GuideRoute,
  LibraryRoute,
  ViewerRoute,
  type RouteContext,
} from './routeScreens';
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

export function RootNavigator({
  pack,
  progress,
}: {
  pack: Pack;
  progress: ProgressStorage;
}) {
  const context = useMemo<RouteContext>(
    () => ({
      catalog: catalogFor(pack),
      progress,
    }),
    [pack, progress],
  );
  return (
    <NavigationContainer theme={NAVIGATION_THEME}>
      <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
        <Stack.Screen name={Route.library}>
          {props => <LibraryRoute {...props} {...context} />}
        </Stack.Screen>
        <Stack.Screen name={Route.guide}>
          {props => <GuideRoute {...props} {...context} />}
        </Stack.Screen>
        <Stack.Screen name={Route.viewer} options={VIEWER_OPTIONS}>
          {props => <ViewerRoute {...props} {...context} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
