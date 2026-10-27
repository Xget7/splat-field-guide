import type { ARPlacementState } from 'react-native-splat';
import {
  initialAssembledCount,
  SizeLimits,
  type AssemblyBatch,
  type AssemblySession,
} from './assemblySession';

/** What the primary button does when pressed. */
export const PrimaryAction = {
  none: 'none',
  settings: 'settings',
  retry: 'retry',
  place: 'place',
  preview: 'preview',
  next: 'next',
} as const;
export type PrimaryAction = (typeof PrimaryAction)[keyof typeof PrimaryAction];

/** The primary button's glyph, named apart from the icon set so the rules stay free of presentation. */
export const TourIcon = {
  next: 'next',
  camera: 'camera',
  repeat: 'repeat',
  frame: 'frame',
  check: 'check',
} as const;
export type TourIcon = (typeof TourIcon)[keyof typeof TourIcon];

/** A command the tour can send: the assembled part count, the view, and the batch that moves. */
export interface TourMove {
  readonly step: number;
  readonly exploded: boolean;
  readonly batch: number | null;
  /** Replaces the command still playing instead of waiting for it. */
  readonly interrupt: boolean;
}

export interface PrimaryControl {
  readonly label: string;
  readonly accessibilityLabel: string;
  /** The step count beside the label while the tour is under way. */
  readonly detail?: string;
  readonly icon: TourIcon;
  readonly enabled: boolean;
  readonly action: PrimaryAction;
}

/** Everything the assembly screen shows and may do for one session. */
export interface AssemblyTour {
  /** The placement state, reading as unsupported on a device without AR. */
  readonly state: ARPlacementState;
  readonly placed: boolean;
  /** The parts stand apart for the tour; false while the assembled preview shows. */
  readonly exploded: boolean;
  /** Batches whose parts the native view has reported. */
  readonly batchCount: number;
  readonly completedBatches: number;
  /** The step the menu counts: the moving batch, otherwise the completed ones. */
  readonly menuStep: number;
  /** The tour is placed, exploded and not finished, so the next batch is named. */
  readonly inProgress: boolean;
  readonly upcomingLabel: string | undefined;
  readonly complete: boolean;
  readonly canAssemble: boolean;
  readonly canAnimate: boolean;
  readonly canSkip: boolean;
  readonly canResize: boolean;
  readonly canShrink: boolean;
  readonly canGrow: boolean;
  readonly canLower: boolean;
  readonly canRaise: boolean;
  readonly canRestart: boolean;
  /** Placement is still being looked for, so the screen shows its target. */
  readonly targeting: boolean;
  /** The view accepts size and height changes in this state. */
  readonly sizing: boolean;
  readonly showsMessage: boolean;
  readonly next: TourMove | null;
  readonly previous: TourMove | null;
  readonly preview: TourMove | null;
  readonly restart: TourMove | null;
  readonly primary: PrimaryControl;
}

const SIZING_STATES: readonly ARPlacementState[] = [
  'ready',
  'placed',
  'searching',
];
const TARGETING_STATES: readonly ARPlacementState[] = ['searching', 'ready'];
const MESSAGE_STATES: readonly ARPlacementState[] = [
  'unsupported',
  'error',
  'limited',
];
const SKIP_LABEL = 'Finish this step and start the next';

const move = (
  step: number,
  batch: number | null,
  exploded = true,
  interrupt = false,
): TourMove => ({ step, exploded, batch, interrupt });

export function assemblyTourFor(
  batches: readonly AssemblyBatch[],
  session: AssemblySession,
  supported: boolean,
): AssemblyTour {
  const { assembly, command, animating, activeBatch, event } = session;
  const initial = initialAssembledCount(batches);
  const exploded = command.exploded;
  const state: ARPlacementState = supported ? event.state : 'unsupported';
  const placed = supported && event.placed;
  const batchCount = batches.filter(
    batch => batch.endPartCount <= assembly.parts.length,
  ).length;
  const completedBatches = batches
    .slice(0, batchCount)
    .filter(batch => batch.endPartCount <= assembly.assembledCount).length;
  const displayedBatch = activeBatch ?? completedBatches;
  const upcomingLabel = batches[displayedBatch]?.label;
  const complete =
    batchCount > 0 &&
    assembly.assembledCount === assembly.parts.length &&
    !animating;
  const canAssemble = placed && state === 'placed' && batchCount > 0;
  const canAnimate = canAssemble && !animating;
  const canStep = canAnimate && exploded;
  const canSkip =
    canAssemble &&
    exploded &&
    animating &&
    assembly.phase === 'assembling' &&
    assembly.requestId === command.request &&
    activeBatch !== null;
  const canResize = !animating && SIZING_STATES.includes(state);
  const inProgress = canAssemble && exploded && !complete;

  let next: TourMove | null = null;
  if (canSkip) {
    // Skipping counts from the command's target, which the report has not reached yet.
    const current = batches.findIndex(
      batch => batch.endPartCount === command.step,
    );
    if (current >= 0) {
      const following = Math.min(current + 1, batchCount - 1);
      next = move(batches[following].endPartCount, following, true, true);
    }
  } else if (canStep && completedBatches < batchCount) {
    next = move(batches[completedBatches].endPartCount, completedBatches);
  }

  let previous: TourMove | null = null;
  const prefix = assembly.assembledCount;
  if (canStep && prefix > initial) {
    // Part way through a batch goes back to its start; at a boundary, to the one before.
    const boundary =
      completedBatches === 0 ? 0 : batches[completedBatches - 1].endPartCount;
    const withinBatch = prefix > boundary;
    const target = withinBatch
      ? boundary
      : completedBatches > 1
      ? batches[completedBatches - 2].endPartCount
      : initial;
    previous = move(
      Math.max(initial, target),
      withinBatch ? completedBatches : completedBatches - 1,
    );
  }

  const tour = {
    state,
    placed,
    exploded,
    batchCount,
    completedBatches,
    menuStep:
      animating && activeBatch !== null ? activeBatch + 1 : completedBatches,
    inProgress,
    upcomingLabel,
    complete,
    canAssemble,
    canAnimate,
    canSkip,
    canResize,
    canShrink: canResize && event.scale > SizeLimits.minScale,
    canGrow: canResize && event.scale < SizeLimits.maxScale,
    canLower: canResize && session.elevation > SizeLimits.minElevation,
    canRaise: canResize && session.elevation < SizeLimits.maxElevation,
    canRestart: canAnimate && !(prefix <= initial && exploded),
    targeting: !placed && TARGETING_STATES.includes(state),
    sizing: SIZING_STATES.includes(state),
    showsMessage: MESSAGE_STATES.includes(state),
    next,
    previous,
    preview: canAnimate ? move(prefix, null, !exploded) : null,
    restart: canAnimate ? move(initial, null) : null,
  };
  return {
    ...tour,
    primary: primaryFor(tour, canStep, displayedBatch),
  };
}

function primaryFor(
  tour: Omit<AssemblyTour, 'primary'>,
  canStep: boolean,
  displayedBatch: number,
): PrimaryControl {
  const control = (
    label: string,
    icon: TourIcon = TourIcon.next,
    enabled = false,
    action: PrimaryAction = PrimaryAction.none,
  ): PrimaryControl => ({
    label,
    accessibilityLabel: label,
    icon,
    enabled,
    action,
  });
  const { state } = tour;
  if (state === 'permission-denied') {
    return control(
      'Camera settings',
      TourIcon.camera,
      true,
      PrimaryAction.settings,
    );
  }
  if (state === 'error') {
    return control('Try again', TourIcon.repeat, true, PrimaryAction.retry);
  }
  if (state === 'unsupported') {
    return control('AR unavailable');
  }
  if (state === 'requesting-permission') {
    return control('Camera access');
  }
  if (state === 'limited') {
    return control('Restore tracking');
  }
  if (state === 'paused') {
    return control('AR paused');
  }
  if (tour.targeting) {
    const ready = state === 'ready';
    return control(
      ready ? 'Place engine' : 'Find a flat surface',
      TourIcon.frame,
      ready,
      PrimaryAction.place,
    );
  }
  if (!tour.canAssemble) {
    return control('Preparing AR');
  }
  if (!tour.exploded) {
    return control(
      'Continue tour',
      TourIcon.next,
      tour.canAnimate,
      PrimaryAction.preview,
    );
  }
  const label = tour.complete ? 'Assembled' : 'Next step';
  return {
    label,
    accessibilityLabel: tour.canSkip
      ? SKIP_LABEL
      : canStep && !tour.complete
      ? `Next step: ${tour.upcomingLabel}`
      : label,
    detail: tour.inProgress
      ? `${displayedBatch + 1}/${tour.batchCount}`
      : undefined,
    icon: tour.complete ? TourIcon.check : TourIcon.next,
    enabled: tour.canSkip || (tour.canAnimate && !tour.complete),
    action: PrimaryAction.next,
  };
}
