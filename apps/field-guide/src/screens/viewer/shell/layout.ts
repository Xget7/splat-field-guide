/** The iPad viewer's side column: an icon rail, then the open capability's drawer. */
export const RAIL_WIDTH = 64;
export const DRAWER_WIDTH = 320;

export const Capability = {
  guide: 'guide',
  explore: 'explore',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];
