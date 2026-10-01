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
export interface TrackingEvent {
  state: TrackingState;
  message: string;
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
    const { state, message } = event as Record<string, unknown>;
    if (
      typeof state !== 'string' ||
      !Object.hasOwn(STATUS, state) ||
      typeof message !== 'string'
    ) {
      return null;
    }
    return { state: state as TrackingState, message };
  } catch {
    return null;
  }
}

export function pinColor(rgb: number[]): string {
  return `rgb(${rgb.map(channel => Math.round(channel * 255)).join(', ')})`;
}
