import type { SplatViewSpec } from 'react-native-splat';
import { highlightFor, type SessionState } from '../../guide';
import type { Bounds, Pack } from '../../pack/pack';

export const FRAMING_VISIBILITY_THRESHOLD = 0.3;
export const FRAMING_GRID_SIZE = 12;

/** Cell centres avoid counting the box boundary twice and stay inside the viewport. */
export function framingSamples(projected: Float32Array) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < projected.length; i += 2) {
    if (Number.isFinite(projected[i]) && Number.isFinite(projected[i + 1])) {
      xs.push(projected[i]);
      ys.push(projected[i + 1]);
    }
  }
  if (xs.length === 0) {
    return [];
  }
  const left = Math.max(0, Math.min(...xs));
  const right = Math.min(1, Math.max(...xs));
  const top = Math.max(0, Math.min(...ys));
  const bottom = Math.min(1, Math.max(...ys));
  if (left >= right || top >= bottom) {
    return [];
  }
  return Array.from({ length: FRAMING_GRID_SIZE ** 2 }, (_, i) => ({
    x:
      left +
      (((i % FRAMING_GRID_SIZE) + 0.5) * (right - left)) / FRAMING_GRID_SIZE,
    y:
      top +
      ((Math.floor(i / FRAMING_GRID_SIZE) + 0.5) * (bottom - top)) /
        FRAMING_GRID_SIZE,
  }));
}

export function framingVisibility(
  labels: readonly number[],
  targets: readonly number[],
) {
  const accepted = new Set(targets);
  const hits = labels.filter(label => accepted.has(label)).length;
  const visibleFraction = labels.length === 0 ? 0 : hits / labels.length;
  return {
    onScreen: labels.length > 0,
    samples: labels.length,
    hits,
    visibleFraction,
    occluded: visibleFraction < FRAMING_VISIBILITY_THRESHOLD,
  };
}

export function boundsCorners(bounds: Bounds): Float32Array {
  return new Float32Array(
    [bounds.min[0], bounds.max[0]].flatMap(x =>
      [bounds.min[1], bounds.max[1]].flatMap(y =>
        [bounds.min[2], bounds.max[2]].flatMap(z => [x, y, z]),
      ),
    ),
  );
}

/** project and pick use the renderer's last drawn frame, including Metal occlusion. */
export async function measureFraming(
  view: SplatViewSpec,
  bounds: Bounds,
  state: SessionState,
  pack: Pack,
  concurrency = 1,
) {
  const corners = boundsCorners(bounds);
  const projected = new Float32Array((corners.length / 3) * 2);
  view.project(corners.buffer as ArrayBuffer, projected.buffer);
  const labels: number[] = [];
  const samples = framingSamples(projected);
  // Candidate audits bound the number of immutable native reads in flight; the normal
  // audit retains sequential reads and the exact same grid and scoring rules.
  for (let i = 0; i < samples.length; i += concurrency) {
    labels.push(
      ...(await Promise.all(
        samples
          .slice(i, i + concurrency)
          .map(point => view.pick(point.x, point.y)),
      )),
    );
  }
  return framingVisibility(labels, highlightFor(state, pack));
}
