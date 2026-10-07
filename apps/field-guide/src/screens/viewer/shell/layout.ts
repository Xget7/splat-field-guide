import { SlideInLeft, SlideOutLeft } from 'react-native-reanimated';
import { Motion } from '../../../ui/theme';

/** The iPad viewer's side column: an icon rail, then the open capability's drawer. */
export const RAIL_WIDTH = 64;
export const DRAWER_WIDTH = 320;

export const Capability = {
  guide: 'guide',
  explore: 'explore',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

export const DRAWER_IN = SlideInLeft.springify()
  .mass(Motion.spring.mass)
  .damping(Motion.spring.damping)
  .stiffness(Motion.spring.stiffness);
export const DRAWER_OUT = SlideOutLeft.duration(Motion.base);
