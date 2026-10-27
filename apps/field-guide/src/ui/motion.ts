import {
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
} from 'react-native-reanimated';
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

/** The spring a panel resizes and moves with, shared by the panels and the picture beside them. */
export function panelLayout() {
  return LinearTransition.springify()
    .mass(Motion.spring.mass)
    .damping(Motion.spring.damping)
    .stiffness(Motion.spring.stiffness)
    .overshootClamping(Number(Motion.spring.overshootClamping));
}
export const PANEL_LAYOUT = panelLayout();
