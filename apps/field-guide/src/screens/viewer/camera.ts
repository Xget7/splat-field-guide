import type {
  Bounds as SplatBounds,
  CameraLimits as SplatCameraLimits,
  ViewDirection,
} from 'react-native-splat';
import type { Bounds, CameraHome, CameraLimits, Vec3 } from '../../domain/pack';

const RADIANS_PER_DEGREE = Math.PI / 180;
export const FRAME_SECONDS = 0.45;
export const INITIAL_FRAME_SECONDS = 0;
// A part framed edge to edge hides where it sits; framed at this scale it fills about half the
// view, with the engine bay around it.
export const CONTEXT_SCALE = 2;

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

export function homeDirectionInRadians(home: CameraHome): ViewDirection {
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

/** `bounds` grown about its centre by CONTEXT_SCALE. */
export function inContext(bounds: Bounds): Bounds {
  const scaled = (toward: Vec3, from: Vec3): Vec3 =>
    toward.map(
      (value, axis) => from[axis] + (value - from[axis]) * CONTEXT_SCALE,
    ) as unknown as Vec3;
  const centre = bounds.min.map(
    (value, axis) => (value + bounds.max[axis]) / 2,
  ) as unknown as Vec3;
  return { min: scaled(bounds.min, centre), max: scaled(bounds.max, centre) };
}
