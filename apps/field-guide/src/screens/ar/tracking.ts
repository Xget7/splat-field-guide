import type {
  ARTrackingEvent,
  ARTrackingState,
  ARCameraTracking,
} from 'react-native-splat';

export const STATUS = {
  loading: 'Preparing camera',
  'requesting-permission': 'Camera access',
  'permission-denied': 'Camera access needed',
  unsupported: 'AR unavailable',
  searching: 'Looking for your engine',
  tracking: 'Engine located',
  limited: 'Move slowly to find the engine',
  paused: 'Camera paused',
  error: 'Unable to start AR',
} as const satisfies Record<ARTrackingState, string>;
export type TrackingEvent = ARTrackingEvent;

export const CAMERA_STATUS = {
  normal: 'Stable',
  notAvailable: 'Unavailable',
  'limited:initializing': 'Starting',
  'limited:excessiveMotion': 'Move slowly',
  'limited:insufficientFeatures': 'Needs more detail',
  'limited:relocalizing': 'Recovering',
  limited: 'Limited',
} as const satisfies Record<ARCameraTracking, string>;

export const INITIAL_EVENT: TrackingEvent = {
  state: 'loading',
  torchAvailable: false,
  torchEnabled: false,
  message: 'Point at the open engine bay from the front.',
};

export function elapsedTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)
    .toString()
    .padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
}
