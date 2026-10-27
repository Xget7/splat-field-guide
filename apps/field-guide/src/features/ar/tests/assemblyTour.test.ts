import type { ARPlacementState } from 'react-native-splat';
import {
  initialAssemblySession,
  type AssemblyBatch,
  type AssemblySession,
} from '../domain/assemblySession';
import {
  assemblyTourFor,
  PrimaryAction,
  TourIcon,
} from '../domain/assemblyTour';

const BATCHES: readonly AssemblyBatch[] = [
  { id: 'base', label: 'Base', endPartCount: 1 },
  { id: 'pistons', label: 'Pistons', endPartCount: 3 },
  { id: 'heads', label: 'Heads', endPartCount: 6 },
  { id: 'cover', label: 'Cover', endPartCount: 8 },
];
const PART_COUNT = 8;
const PARTS = Array.from({ length: PART_COUNT }, (_, index) => ({
  id: `part${index}`,
  label: `Part ${index}`,
}));
const SUPPORTED = true;
const REQUEST = 5;

/** A session placed on a surface with the parts reported, settled at an assembled count. */
function placed(
  assembledCount: number,
  changes: Partial<AssemblySession> = {},
): AssemblySession {
  const initial = initialAssemblySession(BATCHES);
  return {
    ...initial,
    event: { ...initial.event, state: 'placed', placed: true },
    assembly: {
      parts: PARTS,
      assembledCount,
      phase: 'idle',
      requestId: REQUEST,
    },
    command: { step: assembledCount, request: REQUEST, exploded: true },
    ...changes,
  };
}

const tourOf = (session: AssemblySession, supported = SUPPORTED) =>
  assemblyTourFor(BATCHES, session, supported);

describe('before placement', () => {
  test.each<[ARPlacementState, string, boolean, PrimaryAction]>([
    ['loading', 'Preparing AR', false, PrimaryAction.none],
    ['requesting-permission', 'Camera access', false, PrimaryAction.none],
    ['permission-denied', 'Camera settings', true, PrimaryAction.settings],
    ['error', 'Try again', true, PrimaryAction.retry],
    ['searching', 'Find a flat surface', false, PrimaryAction.place],
    ['ready', 'Place engine', true, PrimaryAction.place],
    ['limited', 'Restore tracking', false, PrimaryAction.none],
    ['paused', 'AR paused', false, PrimaryAction.none],
  ])('%s offers %s', (state, label, enabled, action) => {
    const initial = initialAssemblySession(BATCHES);
    const tour = tourOf({ ...initial, event: { ...initial.event, state } });
    expect(tour.primary).toMatchObject({ label, enabled, action });
    expect(tour.primary.accessibilityLabel).toBe(label);
    expect(tour.canAssemble).toBe(false);
  });

  test('a device without AR reads as unsupported whatever the view reports', () => {
    const tour = tourOf(placed(1), false);
    expect(tour.state).toBe('unsupported');
    expect(tour.placed).toBe(false);
    expect(tour.primary).toMatchObject({
      label: 'AR unavailable',
      enabled: false,
      action: PrimaryAction.none,
    });
  });
});

test('the first step brings the second batch in, with nothing to separate yet', () => {
  const tour = tourOf(placed(1));
  expect(tour).toMatchObject({
    batchCount: 4,
    completedBatches: 1,
    menuStep: 1,
    inProgress: true,
    upcomingLabel: 'Pistons',
    complete: false,
    canRestart: false,
    previous: null,
  });
  expect(tour.primary).toEqual({
    label: 'Next step',
    accessibilityLabel: 'Next step: Pistons',
    detail: '2/4',
    icon: TourIcon.next,
    enabled: true,
    action: PrimaryAction.next,
  });
  expect(tour.next).toEqual({
    step: 3,
    exploded: true,
    batch: 1,
    interrupt: false,
  });
});

test('a middle step moves forward a batch and back to the boundary before it', () => {
  const atBoundary = tourOf(placed(3));
  expect(atBoundary.next).toEqual({
    step: 6,
    exploded: true,
    batch: 2,
    interrupt: false,
  });
  expect(atBoundary.previous).toEqual({
    step: 1,
    exploded: true,
    batch: 1,
    interrupt: false,
  });
  expect(atBoundary.canRestart).toBe(true);
  const betweenBoundaries = tourOf(placed(4));
  expect(betweenBoundaries.previous).toEqual({
    step: 3,
    exploded: true,
    batch: 2,
    interrupt: false,
  });
});

test('Next during a step finishes it and starts the following one', () => {
  const moving = placed(3, {
    command: { step: 6, request: REQUEST, exploded: true },
    assembly: {
      parts: PARTS,
      assembledCount: 3,
      phase: 'assembling',
      requestId: REQUEST,
    },
    animating: true,
    activeBatch: 2,
  });
  const tour = tourOf(moving);
  expect(tour.canSkip).toBe(true);
  expect(tour.menuStep).toBe(3);
  expect(tour.primary).toMatchObject({
    label: 'Next step',
    accessibilityLabel: 'Finish this step and start the next',
    detail: '3/4',
    enabled: true,
    action: PrimaryAction.next,
  });
  expect(tour.next).toEqual({
    step: 8,
    exploded: true,
    batch: 3,
    interrupt: true,
  });
  expect(tour.previous).toBeNull();
  expect(tour.preview).toBeNull();
  expect(tour.canResize).toBe(false);
});

test('a report for an earlier command cannot be skipped', () => {
  const tour = tourOf(
    placed(3, {
      command: { step: 6, request: REQUEST + 1, exploded: true },
      assembly: {
        parts: PARTS,
        assembledCount: 3,
        phase: 'assembling',
        requestId: REQUEST,
      },
      animating: true,
      activeBatch: 2,
    }),
  );
  expect(tour.canSkip).toBe(false);
  expect(tour.next).toBeNull();
  expect(tour.primary.enabled).toBe(false);
});

test('the last step skips to itself and the finished tour reads as assembled', () => {
  const lastMove = tourOf(
    placed(6, {
      command: { step: 8, request: REQUEST, exploded: true },
      assembly: {
        parts: PARTS,
        assembledCount: 6,
        phase: 'assembling',
        requestId: REQUEST,
      },
      animating: true,
      activeBatch: 3,
    }),
  );
  expect(lastMove.next).toMatchObject({ step: 8, batch: 3, interrupt: true });

  const finished = tourOf(placed(8));
  expect(finished).toMatchObject({
    complete: true,
    inProgress: false,
    completedBatches: 4,
    next: null,
  });
  expect(finished.primary).toEqual({
    label: 'Assembled',
    accessibilityLabel: 'Assembled',
    icon: TourIcon.check,
    enabled: false,
    action: PrimaryAction.next,
  });
  expect(finished.previous).toEqual({
    step: 6,
    exploded: true,
    batch: 3,
    interrupt: false,
  });
});

test('the assembled preview returns to the tour at the same step', () => {
  const exploded = tourOf(placed(3));
  expect(exploded.preview).toEqual({
    step: 3,
    exploded: false,
    batch: null,
    interrupt: false,
  });
  const preview = tourOf(
    placed(3, { command: { step: 3, request: REQUEST, exploded: false } }),
  );
  expect(preview).toMatchObject({ inProgress: false, next: null });
  expect(preview.primary).toMatchObject({
    label: 'Continue tour',
    icon: TourIcon.next,
    enabled: true,
    action: PrimaryAction.preview,
  });
  expect(preview.preview).toEqual({
    step: 3,
    exploded: true,
    batch: null,
    interrupt: false,
  });
  const playing = tourOf(
    placed(3, {
      command: { step: 3, request: REQUEST, exploded: false },
      assembly: {
        parts: PARTS,
        assembledCount: 3,
        phase: 'previewing',
        requestId: REQUEST,
      },
      animating: true,
    }),
  );
  expect(playing.primary).toMatchObject({
    label: 'Continue tour',
    enabled: false,
    action: PrimaryAction.preview,
  });
  const completePreview = tourOf(
    placed(8, { command: { step: 8, request: REQUEST, exploded: false } }),
  );
  expect(completePreview.primary).toMatchObject({
    label: 'Continue tour',
    icon: TourIcon.next,
    enabled: true,
  });
  expect(completePreview.canRestart).toBe(true);
});

test('restart separates every batch but the first', () => {
  expect(tourOf(placed(6)).restart).toEqual({
    step: 1,
    exploded: true,
    batch: null,
    interrupt: false,
  });
});
