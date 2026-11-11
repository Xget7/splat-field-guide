import { highlightFor } from '../../guide';
import type { Pack } from '../../pack/pack';
import {
  boundsCorners,
  framingSamples,
  framingVisibility,
  FRAMING_GRID_SIZE,
} from '../domain/framingAudit';

it('samples cell centres inside the clipped viewport', () => {
  const points = framingSamples(new Float32Array([-1, -2, 2, 3, NaN, NaN]));
  expect(points).toHaveLength(FRAMING_GRID_SIZE ** 2);
  expect(points[0]).toEqual({
    x: 0.5 / FRAMING_GRID_SIZE,
    y: 0.5 / FRAMING_GRID_SIZE,
  });
  expect(points.every(p => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1)).toBe(
    true,
  );
});
it('reports off-screen and behind-camera bounds without samples', () => {
  expect(framingSamples(new Float32Array([2, 0, 3, 1]))).toEqual([]);
  expect(framingSamples(new Float32Array([NaN, NaN]))).toEqual([]);
  expect(framingVisibility([], [1])).toEqual({
    onScreen: false,
    samples: 0,
    hits: 0,
    visibleFraction: 0,
    occluded: true,
  });
});
it('uses a strict 0.3 threshold and counts background misses', () => {
  expect(framingVisibility([1, 1, 1, 0, 0, 0, 2, 2, 2, 2], [1])).toMatchObject({
    hits: 3,
    visibleFraction: 0.3,
    occluded: false,
  });
  expect(framingVisibility([1, 0, 2, 2], [1])).toMatchObject({
    visibleFraction: 0.25,
    occluded: true,
  });
});
it('accepts descendant labels through the guide highlight contract', () => {
  const pack = {
    parts: [
      { id: 'assembly', label: 1, parent: null },
      { id: 'child', label: 2, parent: 'assembly' },
      { id: 'grandchild', label: 3, parent: 'child' },
      { id: 'other', label: 4, parent: null },
    ],
  } as unknown as Pack;
  const targets = highlightFor(
    { procedureId: null, stepIndex: 0, selectedPart: 'assembly' },
    pack,
  );
  expect(framingVisibility([1, 2, 3, 4, 0], targets)).toMatchObject({
    hits: 3,
    samples: 5,
    visibleFraction: 0.6,
  });
});
it('emits all eight bounds corners without camera calculations', () => {
  const corners = boundsCorners({ min: [1, 2, 3], max: [4, 5, 6] });
  expect(corners).toHaveLength(24);
  expect(Array.from(corners.slice(0, 6))).toEqual([1, 2, 3, 1, 2, 6]);
});
