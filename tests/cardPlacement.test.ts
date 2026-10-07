import {
  placeOn,
  Side,
  sideFor,
} from '../apps/field-guide/src/screens/viewer/stage/cardPlacement';

const AREA = { left: 0, top: 0, right: 1000, bottom: 800 };
const CARD = { width: 300, height: 120 };
const GAP = 8;

describe('part card placement', () => {
  test('takes the roomiest side, and keeps its side while the card fits there', () => {
    const nearRightEdge = { left: 600, top: 300, right: 900, bottom: 500 };
    expect(sideFor(nearRightEdge, CARD, AREA, GAP, null)).toBe(Side.left);
    expect(placeOn(Side.left, nearRightEdge, CARD, AREA, GAP)).toEqual({
      x: 292,
      y: 300,
    });
    const centred = { left: 350, top: 300, right: 650, bottom: 500 };
    expect(sideFor(centred, CARD, AREA, GAP, Side.left)).toBe(Side.left);
  });

  test('overlaps the part inside the area when no side has room', () => {
    const filling = { left: 50, top: 50, right: 950, bottom: 750 };
    const side = sideFor(filling, CARD, AREA, GAP, null);
    const { x, y } = placeOn(side, filling, CARD, AREA, GAP);
    expect(x).toBeGreaterThanOrEqual(AREA.left);
    expect(x + CARD.width).toBeLessThanOrEqual(AREA.right);
    expect(y).toBeGreaterThanOrEqual(AREA.top);
    expect(y + CARD.height).toBeLessThanOrEqual(AREA.bottom);
  });
});
