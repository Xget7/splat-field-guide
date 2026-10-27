import { createStore, type StoreApi } from 'zustand/vanilla';
import type {
  ARAssemblyEvent,
  ARAssemblyPart,
  ARPlacementEvent,
} from 'react-native-splat';
import {
  clampElevation,
  clampScale,
  initialAssemblySession,
  SizeLimits,
  type AssemblyBatch,
  type AssemblySession,
} from '../domain/assemblySession';
import type { TourMove } from '../domain/assemblyTour';

const SETTINGS_FAILURE = 'Enable camera access for Field Guide in Settings.';

export interface AssemblyActions {
  /** Sends a move unless one is on its way; an interrupting move needs the current command playing. */
  issue(move: TourMove): void;
  /** Reports from a native view of an earlier attempt are ignored. */
  receivePlacement(attempt: number, event: ARPlacementEvent): void;
  /** Reports for an earlier command or attempt are ignored. */
  receiveAssembly(attempt: number, event: ARAssemblyEvent): void;
  resize(scale: number): void;
  lower(): void;
  raise(): void;
  requestPlacement(): void;
  /** Lifts the engine off its surface to look for another, unless a move is playing. */
  relocate(): void;
  toggleMenu(): void;
  settingsFailed(): void;
  /** Starts over with a new native view. */
  retry(): void;
}

export type AssemblyStoreState = AssemblySession & AssemblyActions;
export type AssemblyStore = StoreApi<AssemblyStoreState>;

function sameParts(
  before: readonly ARAssemblyPart[],
  after: readonly ARAssemblyPart[],
) {
  return (
    before.length === after.length &&
    before.every(
      (part, index) =>
        part.id === after[index].id && part.label === after[index].label,
    )
  );
}

/**
 * One assembly tour visit. Native callbacks read the latest state through the actions, so a
 * report that arrives after a newer command or a retry cannot overwrite it.
 */
export function createAssemblyStore(
  batches: readonly AssemblyBatch[],
): AssemblyStore {
  return createStore<AssemblyStoreState>()((set, get) => ({
    ...initialAssemblySession(batches),
    issue(move) {
      const { animating, assembly, command } = get();
      // Wait for the current command to start before accepting another skip.
      if (animating && !move.interrupt) {
        return;
      }
      if (
        move.interrupt &&
        (assembly.phase !== 'assembling' ||
          assembly.requestId !== command.request)
      ) {
        return;
      }
      set({
        animating: true,
        activeBatch: move.batch,
        command: {
          step: move.step,
          request: command.request + 1,
          exploded: move.exploded,
        },
      });
    },
    receivePlacement(attempt, event) {
      if (attempt === get().attempt) {
        set({ event, scale: event.scale });
      }
    },
    receiveAssembly(attempt, event) {
      const current = get();
      if (
        attempt !== current.attempt ||
        event.requestId !== current.command.request
      ) {
        return;
      }
      const idle = event.phase === 'idle';
      // A settled command or a newly loaded model takes the view's count as the step.
      const settles =
        idle &&
        (current.animating || !sameParts(current.assembly.parts, event.parts));
      const command = settles
        ? { ...current.command, step: event.assembledCount }
        : current.command;
      set(
        idle
          ? { assembly: event, command, animating: false, activeBatch: null }
          : { assembly: event, command, animating: true },
      );
    },
    resize(scale) {
      set(state => ({
        scale: clampScale(scale),
        scaleRequest: state.scaleRequest + 1,
      }));
    },
    lower() {
      set(state => ({
        elevation: clampElevation(state.elevation - SizeLimits.elevationStep),
      }));
    },
    raise() {
      set(state => ({
        elevation: clampElevation(state.elevation + SizeLimits.elevationStep),
      }));
    },
    requestPlacement() {
      set(state => ({ placementRequest: state.placementRequest + 1 }));
    },
    relocate() {
      if (get().animating) {
        return;
      }
      set(state => ({
        menuOpen: false,
        event: { ...state.event, state: 'searching', placed: false },
        resetRequest: state.resetRequest + 1,
      }));
    },
    toggleMenu() {
      set(state => ({ menuOpen: !state.menuOpen }));
    },
    settingsFailed() {
      set(state => ({
        event: { ...state.event, state: 'error', message: SETTINGS_FAILURE },
      }));
    },
    retry() {
      set(initialAssemblySession(batches, get().attempt + 1));
    },
  }));
}
