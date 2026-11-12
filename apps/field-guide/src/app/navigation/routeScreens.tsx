import { NativeModules } from 'react-native';
import { createCourseDocuments } from '../../platform/documents';
import { useIsFocused } from '@react-navigation/native';
import { useCallback } from 'react';
import type { ProgressStorage } from '../../features/guide';
import { GuideDetailScreen } from '../../features/guide/views';
import { LibraryScreen } from '../../features/library/views';
import type { Guide } from '../../features/pack/catalog';
import { ViewerScreen } from '../../features/viewer/views';
import { Route, type ScreenProps } from './routes';

/** What every route adapter reads beside its route and navigation. */
export interface RouteContext {
  readonly catalog: readonly Guide[];
  readonly progress: ProgressStorage;
}

type AdapterProps<R extends Route> = ScreenProps<R> & RouteContext;

const courseDocuments = createCourseDocuments(NativeModules.CourseDocuments);

// Each adapter maps its route params and the navigation to the screen's props, so screens
// know nothing of the navigator.

export function LibraryRoute({
  navigation,
  catalog,
  progress,
}: AdapterProps<typeof Route.library>) {
  return (
    <LibraryScreen
      documents={courseDocuments}
      catalog={catalog}
      progress={progress}
      onOpenGuide={guide =>
        navigation.navigate(Route.guide, { guideId: guide.id })
      }
      onOpen={start => navigation.navigate(Route.viewer, start)}
    />
  );
}

export function GuideRoute({
  navigation,
  route,
  catalog,
}: AdapterProps<typeof Route.guide>) {
  const { guideId } = route.params;
  const active = useIsFocused();
  return (
    <GuideDetailScreen
      active={active}
      catalog={catalog}
      guideId={guideId}
      onBack={() => navigation.goBack()}
      onOpen={start => navigation.navigate(Route.viewer, start)}
    />
  );
}

export function ViewerRoute({
  navigation,
  route,
  catalog,
  progress,
}: AdapterProps<typeof Route.viewer>) {
  // The viewer's step and leave handlers depend on the exit, so it keeps one identity.
  const exit = useCallback(() => navigation.goBack(), [navigation]);
  return (
    <ViewerScreen
      catalog={catalog}
      start={route.params}
      onExit={exit}
      progress={progress}
    />
  );
}
