import type {
  Bounds as SplatBounds,
  CameraLimits as SplatCameraLimits,
  ViewDirection,
} from 'react-native-splat';
import type { Bounds, CameraHome, CameraLimits } from '../domain/pack';

const RADIANS_PER_DEGREE = Math.PI / 180;
export const FRAME_SECONDS = 0.45;
export const INITIAL_FRAME_SECONDS = 0;

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
