import {
  DarkTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { catalogFor } from '../../modules/catalog/catalog';
import { CatalogProvider } from '../../modules/catalog/CatalogContext';
import type { Pack } from '../../domain/pack';
import { GuideDetailScreen } from '../../features/guide-detail/screens/GuideDetailScreen';
import { LibraryScreen } from '../../features/library/screens/LibraryScreen';
import { ViewerScreen } from '../../features/viewer/screens/ViewerScreen';
import { ARScreen } from '../../features/ar/screens/ARScreen';
import { Color } from '../../shared/ui/theme';
import { Route, type RootStackParamList } from '../../shared/navigation/routes';

const Stack = createNativeStackNavigator<RootStackParamList>();

const NAVIGATION_THEME: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Color.black,
    card: Color.black,
    primary: Color.accent,
    text: Color.text,
    border: Color.line,
  },
};

const SCREEN_OPTIONS = {
  headerShown: false,
  contentStyle: { backgroundColor: Color.black },
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
          <Stack.Screen
            name={Route.ar}
            component={ARScreen}
            options={VIEWER_OPTIONS}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </CatalogProvider>
  );
}
