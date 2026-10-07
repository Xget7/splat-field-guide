import {
  DarkTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { catalogFor } from '../features/pack/catalog';
import { offersArCheck } from './arCheck';
import { CatalogProvider } from './CatalogContext';
import type { Pack } from '../features/pack/pack';
import { GuideDetailScreen } from '../screens/guide-detail/GuideDetailScreen';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { ViewerScreen } from '../screens/viewer/ViewerScreen';
import { ARScreen } from '../screens/ar/ARScreen';
import { Color } from '../ui/theme';
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
      <NavigationContainer theme={NAVIGATION_THEME}>
        <Stack.Navigator screenOptions={SCREEN_OPTIONS}>
          <Stack.Screen name={Route.library} component={LibraryScreen} />
          <Stack.Screen name={Route.guide} component={GuideDetailScreen} />
          <Stack.Screen
            name={Route.viewer}
            component={ViewerScreen}
            options={VIEWER_OPTIONS}
          />
          {offersArCheck() && (
            <Stack.Screen
              name={Route.ar}
              component={ARScreen}
              options={VIEWER_OPTIONS}
            />
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </CatalogProvider>
  );
}
