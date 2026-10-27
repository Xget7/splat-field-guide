import { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { Motion } from './theme';

// Fades move nothing, so they stay on with reduced motion.
export const FADE_IN = FadeIn.duration(Motion.base).reduceMotion(
  ReduceMotion.Never,
);
export const FADE_OUT = FadeOut.duration(Motion.base).reduceMotion(
  ReduceMotion.Never,
);
/** The quicker exit of the instructor controls and the tool row above them. */
export const FADE_OUT_FAST = FadeOut.duration(Motion.fast).reduceMotion(
  ReduceMotion.Never,
);
