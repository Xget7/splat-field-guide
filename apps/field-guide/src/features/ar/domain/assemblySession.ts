import type { ARAssemblyEvent, ARPlacementEvent } from 'react-native-splat';

/** A group of parts one assembly tour step brings together, ending at a part count. */
export interface AssemblyBatch {
  readonly id: string;
  readonly label: string;
  readonly endPartCount: number;
}

/** The command last sent to the native view: how many parts stand assembled, and whether exploded. */
export interface AssemblyCommand {
  readonly step: number;
  readonly request: number;
  readonly exploded: boolean;
}

/** One visit to the assembly tour, from the placement on a surface to the assembled parts. */
export interface AssemblySession {
  readonly event: ARPlacementEvent;
  /** The native view's latest report for the current command. */
  readonly assembly: ARAssemblyEvent;
  readonly command: AssemblyCommand;
  /** The batch whose parts are moving, or null for a whole-tour move. */
  readonly activeBatch: number | null;
  readonly menuOpen: boolean;
  /** A command is on its way or playing; it starts with the command, before the native view reports. */
  readonly animating: boolean;
  readonly scale: number;
  readonly elevation: number;
  readonly scaleRequest: number;
  readonly placementRequest: number;
  readonly resetRequest: number;
  /** Counts retries; each one mounts a new native view whose reports alone count. */
  readonly attempt: number;
}

export const SizeLimits = {
  defaultScale: 1,
  minScale: 0.1,
  maxScale: 2,
  scaleFactor: 1.25,
  defaultElevation: 0.5,
  minElevation: 0,
  maxElevation: 2,
  elevationStep: 0.25,
} as const;

export const INITIAL_PLACEMENT: ARPlacementEvent = {
  state: 'loading',
  message: 'Preparing the engine and camera.',
  scale: SizeLimits.defaultScale,
  placed: false,
};

/** The tour starts with its first batch, the crankshaft, already in place. */
export function initialAssembledCount(
  batches: readonly AssemblyBatch[],
): number {
  return batches[0].endPartCount;
}

export function initialAssemblySession(
  batches: readonly AssemblyBatch[],
  attempt = 0,
): AssemblySession {
  const assembled = initialAssembledCount(batches);
  return {
    event: INITIAL_PLACEMENT,
    assembly: {
      parts: [],
      assembledCount: assembled,
      phase: 'idle',
      requestId: 0,
    },
    command: { step: assembled, request: 0, exploded: true },
    activeBatch: null,
    menuOpen: false,
    animating: false,
    scale: SizeLimits.defaultScale,
    elevation: SizeLimits.defaultElevation,
    scaleRequest: 0,
    placementRequest: 0,
    resetRequest: 0,
    attempt,
  };
}

export const clampScale = (scale: number) =>
  Math.min(SizeLimits.maxScale, Math.max(SizeLimits.minScale, scale));

export const clampElevation = (elevation: number) =>
  Math.min(
    SizeLimits.maxElevation,
    Math.max(SizeLimits.minElevation, elevation),
  );
