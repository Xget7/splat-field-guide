import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SessionStart } from '../../features/guide';

export const Route = {
  library: 'Library',
  guide: 'Guide',
  viewer: 'Viewer',
} as const;
export type Route = (typeof Route)[keyof typeof Route];

export type RootStackParamList = {
  [Route.library]: undefined;
  [Route.guide]: { guideId: string };
  [Route.viewer]: SessionStart;
};

export type ScreenProps<R extends Route> = NativeStackScreenProps<
  RootStackParamList,
  R
>;
