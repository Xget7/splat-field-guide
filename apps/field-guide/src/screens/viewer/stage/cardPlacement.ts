import type {
  ScreenBox,
  Size,
} from '../../../features/viewport/projectedParts';

/** Room the card leaves clear along each edge of the stage, for its other overlays. */
export interface Clearance {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Where the card sits against its part's box. */
export const Side = { right: 0, left: 1, below: 2, above: 3 } as const;
export type Side = (typeof Side)[keyof typeof Side];

const SIDES: readonly Side[] = [Side.right, Side.left, Side.below, Side.above];
// Points of room another side needs over the current one before the card moves,
// so an orbit that leaves no side free does not flick it back and forth.
const STICKINESS = 24;

function clampInto(value: number, low: number, high: number) {
  'worklet';
  return Math.max(low, Math.min(value, high));
}

/** Room left over on `side` once the card and its gap fit; negative when it does not. */
function roomOn(
  side: Side,
  box: ScreenBox,
  card: Size,
  area: ScreenBox,
  gap: number,
) {
  'worklet';
  switch (side) {
    case Side.right:
      return area.right - box.right - gap - card.width;
    case Side.left:
      return box.left - area.left - gap - card.width;
    case Side.below:
      return area.bottom - box.bottom - gap - card.height;
    default:
      return box.top - area.top - gap - card.height;
  }
}

/** Keeps the current side while the card fits there, else takes the roomiest one. */
export function sideFor(
  box: ScreenBox,
  card: Size,
  area: ScreenBox,
  gap: number,
  current: Side | null,
): Side {
  'worklet';
  if (current !== null && roomOn(current, box, card, area, gap) >= 0) {
    return current;
  }
  let best: Side = SIDES[0];
  let bestRoom = -Infinity;
  for (const side of SIDES) {
    const room =
      roomOn(side, box, card, area, gap) + (side === current ? STICKINESS : 0);
    if (room > bestRoom) {
      best = side;
      bestRoom = room;
    }
  }
  return best;
}

/**
 * The card's top left on `side`, level with the box's top or left edge.
 * Kept inside `area`, it overlaps the part when no side has room for it.
 */
export function placeOn(
  side: Side,
  box: ScreenBox,
  card: Size,
  area: ScreenBox,
  gap: number,
): { x: number; y: number } {
  'worklet';
  const x =
    side === Side.right
      ? box.right + gap
      : side === Side.left
      ? box.left - gap - card.width
      : box.left;
  const y =
    side === Side.below
      ? box.bottom + gap
      : side === Side.above
      ? box.top - gap - card.height
      : box.top;
  return {
    x: clampInto(x, area.left, area.right - card.width),
    y: clampInto(y, area.top, area.bottom - card.height),
  };
}
