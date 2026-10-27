export const PanelMode = {
  expanded: 'expanded',
  minimized: 'minimized',
} as const;
export type PanelMode = (typeof PanelMode)[keyof typeof PanelMode];

export const PanelPan = {
  activation: 8,
  horizontalTolerance: 20,
  distance: 48,
  velocity: 450,
  resistance: 0.2,
  defaultTravel: 240,
} as const;

export function togglePanel(mode: PanelMode): PanelMode {
  return mode === PanelMode.expanded ? PanelMode.minimized : PanelMode.expanded;
}

export function panelAfterDrag(
  mode: PanelMode,
  distance: number,
  velocity: number,
  canceled: boolean,
): PanelMode {
  'worklet';
  if (canceled || !Number.isFinite(distance) || !Number.isFinite(velocity)) {
    return mode;
  }
  const direction =
    Math.abs(velocity) >= PanelPan.velocity
      ? velocity
      : Math.abs(distance) >= PanelPan.distance
      ? distance
      : 0;
  return direction > 0
    ? PanelMode.minimized
    : direction < 0
    ? PanelMode.expanded
    : mode;
}

export function panelOffset(
  mode: PanelMode,
  distance: number,
  travel: number,
): number {
  'worklet';
  if (!Number.isFinite(distance) || !Number.isFinite(travel) || travel <= 0) {
    return 0;
  }
  const low = mode === PanelMode.expanded ? 0 : -travel;
  const high = mode === PanelMode.expanded ? travel : 0;
  return distance < low
    ? low + (distance - low) * PanelPan.resistance
    : distance > high
    ? high + (distance - high) * PanelPan.resistance
    : distance;
}
