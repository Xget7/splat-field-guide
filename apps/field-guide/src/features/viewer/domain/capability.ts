/** What the iPad viewer's side column offers: the procedure's steps, or the parts to explore. */
export const Capability = {
  guide: 'guide',
  explore: 'explore',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];
