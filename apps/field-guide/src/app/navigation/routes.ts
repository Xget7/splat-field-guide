import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SessionStart } from '../../features/guide';

export const Route = {
  library: 'Library',
  guide: 'Guide',
  viewer: 'Viewer',
  ar: 'AR',
  placement: 'ARPlacement',
  assembly: 'ARAssembly',
  bench: 'Bench',
} as const;
export type Route = (typeof Route)[keyof typeof Route];

export type RootStackParamList = {
  [Route.library]: undefined;
  [Route.guide]: { guideId: string };
  [Route.ar]: { guideId: string };
  [Route.placement]: { guideId: string };
  [Route.assembly]: undefined;
  [Route.bench]: undefined;
  [Route.viewer]: SessionStart;
};

export type ScreenProps<R extends Route> = NativeStackScreenProps<
  RootStackParamList,
  R
>;
