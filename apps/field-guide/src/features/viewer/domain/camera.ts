import type {
  Bounds as SplatBounds,
  CameraLimits as SplatCameraLimits,
  ViewDirection,
} from 'react-native-splat';
import type {
  Bounds,
  FrameDirection,
  CameraLimits,
  Vec3,
} from '../../pack/pack';

const RADIANS_PER_DEGREE = Math.PI / 180;
export const FRAME_SECONDS = 0.45;
export const INITIAL_FRAME_SECONDS = 0;
// A camera turning faster than this reads as a whip pan and makes people dizzy.
export const MAX_TURN_DEGREES_PER_SECOND = 70;
export const MIN_MOVE_SECONDS = 0.6;
// Even the widest swing between steps stays a continuous move; this caps how long it waits.
export const MAX_MOVE_SECONDS = 2.8;
// Reduce Motion replaces the move with a brief fade, which carries no motion of its own.
export const CUT_FADE_MS = 180;
export const CUT_REVEAL_MS = 260;
// Leave the surrounding equipment visible so the part retains its context.
export const CONTEXT_SCALE = 2;
// A slow push-in keeps spoken explanations visually continuous.
export const CLOSE_UP_SCALE = 1.4;
export const CLOSE_UP_SECONDS = 0.9;

export function cameraLimitsInRadians(limits: CameraLimits): SplatCameraLimits {
  return {
    minAzimuth: limits.minAzimuth * RADIANS_PER_DEGREE,
    maxAzimuth: limits.maxAzimuth * RADIANS_PER_DEGREE,
    minElevation: limits.minElevation * RADIANS_PER_DEGREE,
    maxElevation: limits.maxElevation * RADIANS_PER_DEGREE,
    minRadius: limits.minRadius,
    maxRadius: limits.maxRadius,
  };
}

export function homeDirectionInRadians(home: FrameDirection): ViewDirection {
  return {
    azimuth: home.azimuth * RADIANS_PER_DEGREE,
    elevation: home.elevation * RADIANS_PER_DEGREE,
  };
}

export function boundsForView(bounds: Bounds): SplatBounds {
  return {
    min: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
    max: { x: bounds.max[0], y: bounds.max[1], z: bounds.max[2] },
  };
}

export function inContext(bounds: Bounds, scale = CONTEXT_SCALE): Bounds {
  const scaled = (toward: Vec3, from: Vec3): Vec3 =>
    toward.map(
      (value, axis) => from[axis] + (value - from[axis]) * scale,
    ) as unknown as Vec3;
  const centre = bounds.min.map(
    (value, axis) => (value + bounds.max[axis]) / 2,
  ) as unknown as Vec3;
  return { min: scaled(bounds.min, centre), max: scaled(bounds.max, centre) };
}

/** Guided steps and the dev audit share the renderer inputs, including context distance. */
export function guideFrameBounds(bounds: Bounds, closeUp = false): SplatBounds {
  return boundsForView(
    inContext(bounds, closeUp ? CLOSE_UP_SCALE : CONTEXT_SCALE),
  );
}

export type Transition =
  | { readonly kind: 'move'; readonly seconds: number }
  | { readonly kind: 'cut' };

/**
 * Picks how the camera reaches a new step. The engine interpolates azimuth and elevation
 * linearly, so the larger of the two deltas is the turn the viewer sees.
 */
export function transitionBetween(
  current: ViewDirection | undefined,
  target: ViewDirection,
  reducedMotion: boolean,
): Transition {
  if (reducedMotion) {
    return { kind: 'cut' };
  }
  if (current === undefined) {
    return { kind: 'move', seconds: MIN_MOVE_SECONDS };
  }
  const turn =
    Math.max(
      Math.abs(target.azimuth - current.azimuth),
      Math.abs(target.elevation - current.elevation),
    ) / RADIANS_PER_DEGREE;
  return {
    kind: 'move',
    seconds: Math.min(
      MAX_MOVE_SECONDS,
      Math.max(MIN_MOVE_SECONDS, turn / MAX_TURN_DEGREES_PER_SECOND),
    ),
  };
}
