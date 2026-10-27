import { useCallback } from 'react';
import {
  ARAssemblyScreen,
  ARPlacementScreen,
  ARScreen,
} from '../../features/ar/views';
import { BenchScreen } from '../../features/bench/views';
import { GuideDetailScreen } from '../../features/guide/views';
import { LibraryScreen } from '../../features/library/views';
import type { Guide } from '../../features/pack/catalog';
import { ViewerScreen } from '../../features/viewer/views';
import { Route, type ScreenProps } from './routes';

/** What the device offers beyond the guides, decided once at startup. */
export interface Offers {
  readonly arCheck: boolean;
  readonly assembly: boolean;
}

/** What every route adapter reads beside its route and navigation. */
export interface RouteContext {
  readonly catalog: readonly Guide[];
  readonly offers: Offers;
}

type AdapterProps<R extends Route> = ScreenProps<R> & RouteContext;

// Each adapter maps its route params and the navigation to the screen's props, so screens
// know nothing of the navigator.

export function LibraryRoute({
  navigation,
  catalog,
  offers,
}: AdapterProps<typeof Route.library>) {
  return (
    <LibraryScreen
      catalog={catalog}
      onOpenGuide={guide =>
        navigation.navigate(Route.guide, { guideId: guide.id })
      }
      onOpen={start => navigation.navigate(Route.viewer, start)}
      onOpenAssembly={
        offers.assembly ? () => navigation.navigate(Route.assembly) : undefined
      }
    />
  );
}

export function GuideRoute({
  navigation,
  route,
  catalog,
  offers,
}: AdapterProps<typeof Route.guide>) {
  const { guideId } = route.params;
  return (
    <GuideDetailScreen
      catalog={catalog}
      guideId={guideId}
      onBack={() => navigation.goBack()}
      onOpen={start => navigation.navigate(Route.viewer, start)}
      onOpenArCheck={
        offers.arCheck
          ? () => navigation.navigate(Route.ar, { guideId })
          : undefined
      }
    />
  );
}

export function ViewerRoute({
  navigation,
  route,
  catalog,
}: AdapterProps<typeof Route.viewer>) {
  // The viewer's step and leave handlers depend on the exit, so it keeps one identity.
  const exit = useCallback(() => navigation.goBack(), [navigation]);
  return <ViewerScreen catalog={catalog} start={route.params} onExit={exit} />;
}

export function ArCheckRoute({
  navigation,
  route,
  catalog,
}: AdapterProps<typeof Route.ar>) {
  return (
    <ARScreen
      catalog={catalog}
      guideId={route.params.guideId}
      onBack={() => navigation.goBack()}
    />
  );
}

export function PlacementRoute({
  navigation,
  route,
  catalog,
}: AdapterProps<typeof Route.placement>) {
  return (
    <ARPlacementScreen
      catalog={catalog}
      guideId={route.params.guideId}
      onBack={() => navigation.goBack()}
    />
  );
}

export function AssemblyRoute({
  navigation,
}: AdapterProps<typeof Route.assembly>) {
  return <ARAssemblyScreen onBack={() => navigation.goBack()} />;
}

export function BenchRoute({ catalog }: AdapterProps<typeof Route.bench>) {
  return <BenchScreen catalog={catalog} />;
}
