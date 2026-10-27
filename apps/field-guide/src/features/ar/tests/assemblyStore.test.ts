import type { ARAssemblyEvent, ARPlacementEvent } from 'react-native-splat';
import { SizeLimits, type AssemblyBatch } from '../domain/assemblySession';
import { createAssemblyStore } from '../state/assemblyStore';

const BATCHES: readonly AssemblyBatch[] = [
  { id: 'base', label: 'Base', endPartCount: 1 },
  { id: 'pistons', label: 'Pistons', endPartCount: 3 },
];
const PARTS = [
  { id: 'crank', label: 'Crank' },
  { id: 'piston1', label: 'Piston 1' },
  { id: 'piston2', label: 'Piston 2' },
];
const PLACED: ARPlacementEvent = {
  state: 'placed',
  message: 'Placed.',
  scale: 1,
  placed: true,
};
const NEXT_MOVE = { step: 3, exploded: true, batch: 1, interrupt: false };

const report = (
  requestId: number,
  changes: Partial<ARAssemblyEvent> = {},
): ARAssemblyEvent => ({
  parts: PARTS,
  assembledCount: 1,
  phase: 'idle',
  requestId,
  ...changes,
});

test('reports for an earlier command are ignored until the current one settles', () => {
  const store = createAssemblyStore(BATCHES);
  const { attempt } = store.getState();
  store.getState().receiveAssembly(attempt, report(0));
  store.getState().issue(NEXT_MOVE);
  expect(store.getState()).toMatchObject({
    animating: true,
    activeBatch: 1,
    command: { step: 3, request: 1, exploded: true },
  });
  // A late idle report for the first command must not end the new one.
  store.getState().receiveAssembly(attempt, report(0));
  expect(store.getState().animating).toBe(true);
  store.getState().receiveAssembly(attempt, report(1, { phase: 'assembling' }));
  expect(store.getState().assembly.phase).toBe('assembling');
  store.getState().receiveAssembly(attempt, report(1, { assembledCount: 3 }));
  expect(store.getState()).toMatchObject({
    animating: false,
    activeBatch: null,
    command: { step: 3, request: 1 },
    assembly: { assembledCount: 3, phase: 'idle' },
  });
});

test('a move waits for the one on its way, unless it interrupts the playing command', () => {
  const store = createAssemblyStore(BATCHES);
  const { attempt } = store.getState();
  store.getState().issue(NEXT_MOVE);
  store.getState().issue({ ...NEXT_MOVE, step: 1 });
  expect(store.getState().command).toMatchObject({ step: 3, request: 1 });
  // Until the view reports the command playing, an interruption is refused too.
  store.getState().issue({ ...NEXT_MOVE, interrupt: true });
  expect(store.getState().command.request).toBe(1);
  store.getState().receiveAssembly(attempt, report(1, { phase: 'assembling' }));
  store.getState().issue({ ...NEXT_MOVE, interrupt: true });
  expect(store.getState().command.request).toBe(2);
});

test('after a retry only the new native view is heard', () => {
  const store = createAssemblyStore(BATCHES);
  const stale = store.getState().attempt;
  store.getState().toggleMenu();
  store.getState().retry();
  const current = store.getState().attempt;
  expect(current).not.toBe(stale);
  expect(store.getState().menuOpen).toBe(false);
  store.getState().receivePlacement(stale, PLACED);
  store.getState().receiveAssembly(stale, report(0, { assembledCount: 3 }));
  expect(store.getState().event.state).toBe('loading');
  expect(store.getState().assembly.parts).toEqual([]);
  store.getState().receivePlacement(current, PLACED);
  store.getState().receiveAssembly(current, report(0));
  expect(store.getState().event).toBe(PLACED);
  expect(store.getState().assembly.parts).toBe(PARTS);
});

test('size and height stay within their limits', () => {
  const store = createAssemblyStore(BATCHES);
  store.getState().resize(SizeLimits.maxScale * 2);
  expect(store.getState()).toMatchObject({
    scale: SizeLimits.maxScale,
    scaleRequest: 1,
  });
  store.getState().resize(0);
  expect(store.getState().scale).toBe(SizeLimits.minScale);
  for (let press = 0; press < 10; press += 1) {
    store.getState().raise();
  }
  expect(store.getState().elevation).toBe(SizeLimits.maxElevation);
  for (let press = 0; press < 10; press += 1) {
    store.getState().lower();
  }
  expect(store.getState().elevation).toBe(SizeLimits.minElevation);
});
