import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { GuideId } from '../catalog/catalog';
import type { ProcedureId } from '../domain/pack';

export const Route = {
  library: 'Library',
  guide: 'Guide',
  viewer: 'Viewer',
} as const;
export type Route = (typeof Route)[keyof typeof Route];

/** How the viewer opens: with the instructor panel up, or the step card alone. */
export const LearnMode = {
  instructor: 'instructor',
  selfGuided: 'selfGuided',
} as const;
export type LearnMode = (typeof LearnMode)[keyof typeof LearnMode];

export type RootStackParamList = {
  [Route.library]: undefined;
  [Route.guide]: { guideId: GuideId };
  [Route.viewer]: {
    guideId: GuideId;
    procedureId: ProcedureId;
    stepIndex: number;
    mode: LearnMode;
  };
};

export type ScreenProps<R extends Route> = NativeStackScreenProps<
  RootStackParamList,
  R
>;
