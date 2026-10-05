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
} as const;
export type TrackingState = keyof typeof STATUS;

export const CAMERA_STATUS = {
  normal: 'Stable',
  notAvailable: 'Unavailable',
  'limited:initializing': 'Starting',
  'limited:excessiveMotion': 'Move slowly',
  'limited:insufficientFeatures': 'Needs more detail',
  'limited:relocalizing': 'Recovering',
  limited: 'Limited',
} as const;
export interface TrackingTelemetry {
  sampleTimestamp: number;
  cameraTracking: keyof typeof CAMERA_STATUS;
  cameraFramesPerSecond: number;
  objectAnchors: number;
  trackedObjectAnchors: number;
  allObjectAnchors: number;
  sessionSeconds: number;
  pinsEnabled: boolean;
}

export interface TrackingEvent {
  state: TrackingState;
  message: string;
  torchAvailable?: boolean;
  torchEnabled?: boolean;
  torchError?: string;
  referenceLoaded?: boolean;
  telemetry?: TrackingTelemetry;
}

export const INITIAL_EVENT: TrackingEvent = {
  state: 'loading',
  message: 'Point at the open engine bay from the front.',
};

export function parseEvent(json: string): TrackingEvent | null {
  try {
    const event: unknown = JSON.parse(json);
    if (typeof event !== 'object' || event === null) {
      return null;
    }
    const {
      state,
      message,
      torchAvailable,
      torchEnabled,
      torchError,
      referenceLoaded,
      telemetry,
    } = event as Record<string, unknown>;
    if (
      typeof state !== 'string' ||
      !Object.hasOwn(STATUS, state) ||
      typeof message !== 'string'
    ) {
      return null;
    }
    return {
      state: state as TrackingState,
      message,
      torchAvailable: torchAvailable === true,
      torchEnabled: torchEnabled === true,
      torchError: typeof torchError === 'string' ? torchError : undefined,
      referenceLoaded:
        typeof referenceLoaded === 'boolean' ? referenceLoaded : undefined,
      telemetry: parseTelemetry(telemetry),
    };
  } catch {
    return null;
  }
}

function parseTelemetry(value: unknown): TrackingTelemetry | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const t = value as Record<string, unknown>;
  const numbers = [
    'sampleTimestamp',
    'cameraFramesPerSecond',
    'sessionSeconds',
  ] as const;
  const counts = [
    'objectAnchors',
    'trackedObjectAnchors',
    'allObjectAnchors',
  ] as const;
  if (
    typeof t.cameraTracking !== 'string' ||
    !Object.hasOwn(CAMERA_STATUS, t.cameraTracking) ||
    typeof t.pinsEnabled !== 'boolean' ||
    !numbers.every(
      key =>
        typeof t[key] === 'number' && Number.isFinite(t[key]) && t[key] >= 0,
    ) ||
    !counts.every(
      key =>
        typeof t[key] === 'number' && Number.isInteger(t[key]) && t[key] >= 0,
    ) ||
    (t.trackedObjectAnchors as number) > (t.objectAnchors as number) ||
    (t.objectAnchors as number) > (t.allObjectAnchors as number)
  ) {
    return undefined;
  }
  return t as unknown as TrackingTelemetry;
}

export function elapsedTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)
    .toString()
    .padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
}
