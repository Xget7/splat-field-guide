import { SlideInLeft, SlideOutLeft } from 'react-native-reanimated';
import { BOTTOM_BAND_HEIGHT, Motion } from '../../../../ui/theme';

/** The iPad viewer's side column: an icon rail, then the open capability's drawer. */
export const RAIL_WIDTH = 64;
export const DRAWER_WIDTH = 320;

/** Step and part rows share one height, so both drawers scroll alike. */
export const ROW_HEIGHT = 48;
export const CHEVRON_SIZE = 14;
// One update per frame at 60 Hz is enough to follow a scroll.
export const SCROLL_EVENT_THROTTLE_MS = 16;

/** The tool row fills the bottom band, so it lines up with the collapsed instructor dock. */
export const TOOLS_HEIGHT = BOTTOM_BAND_HEIGHT;
export const DOCK_COLLAPSED = {
  width: 320,
  height: BOTTOM_BAND_HEIGHT,
} as const;
export const DOCK_EXPANDED_WIDTH = 380;
export const DOCK_EXPANDED_HEIGHT = 640;

export const DRAWER_IN = SlideInLeft.springify()
  .mass(Motion.spring.mass)
  .damping(Motion.spring.damping)
  .stiffness(Motion.spring.stiffness);
export const DRAWER_OUT = SlideOutLeft.duration(Motion.base);
