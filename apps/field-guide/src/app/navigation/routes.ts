import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export const Route = {
  library: 'Library',
  guide: 'Guide',
  viewer: 'Viewer',
  ar: 'AR',
  placement: 'ARPlacement',
  assembly: 'ARAssembly',
} as const;
export type Route = (typeof Route)[keyof typeof Route];

export const LearnMode = {
  instructor: 'instructor',
  selfGuided: 'selfGuided',
} as const;
export type LearnMode = (typeof LearnMode)[keyof typeof LearnMode];

export type RootStackParamList = {
  [Route.library]: undefined;
  [Route.guide]: { guideId: string };
  [Route.ar]: { guideId: string };
  [Route.placement]: { guideId: string };
  [Route.assembly]: undefined;
  [Route.viewer]: {
    guideId: string;
    procedureId: string;
    stepIndex: number;
    mode: LearnMode;
    voice?: boolean;
  };
};

export type ScreenProps<R extends Route> = NativeStackScreenProps<
  RootStackParamList,
  R
>;
