import {
  DarkTheme,
  NavigationContainer,
  useNavigationContainerRef,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useMemo } from 'react';
import { catalogFor } from '../../features/pack/catalog';
import type { Pack } from '../../features/pack/pack';
import { LearnMode, type ProgressStorage } from '../../features/guide';

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
  packs,
  progress,
}: {
  packs: readonly Pack[];
  progress: ProgressStorage;
}) {
  const context = useMemo<RouteContext>(
    () => ({
      catalog: catalogFor(packs),
      progress,
    }),
    [packs, progress],
  );
  const navigation = useNavigationContainerRef<RootStackParamList>();
  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    const open = () => {
      const guide = context.catalog[0];
      const procedure = guide?.pack.procedures[0];
      if (!guide || !procedure || !navigation.isReady()) {
        throw new Error('Framing viewer is not ready');
      }
      navigation.navigate(Route.viewer, {
        guideId: guide.id,
        procedureId: procedure.id,
        stepIndex: 0,
        mode: LearnMode.selfGuided,
      });
    };
    const target = globalThis as { fieldGuideOpenFraming?: () => void };
    target.fieldGuideOpenFraming = open;
    return () => {
      if (target.fieldGuideOpenFraming === open) {
        delete target.fieldGuideOpenFraming;
      }
    };
  }, [context, navigation]);
  return (
    <NavigationContainer theme={NAVIGATION_THEME} ref={navigation}>
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
