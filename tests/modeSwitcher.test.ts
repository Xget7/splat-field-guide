import {
  runSwitch,
  SwitchTiming,
} from '../apps/field-guide/src/features/instructor/mode/modeSwitcher';
import { SwitchPiece } from '../apps/field-guide/src/features/events/types';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
const task = (piece: SwitchPiece, start: () => Promise<boolean>) => ({
  piece,
  label: piece,
  fallbackLabel: 'fallback',
  start,
});
test('all pieces start first and independent failures settle without blocking readiness', async () => {
  const emit = jest.fn();
  const done = jest.fn();
  const result = runSwitch(
    1,
    [
      task(SwitchPiece.voice, async () => {
        throw new Error('voice');
      }),
      task(SwitchPiece.answers, async () => true),
    ],
    emit,
  ).then(value => {
    done();
    return value;
  });
  expect(emit.mock.calls.map(call => call[0].state)).toEqual([
    'starting',
    'starting',
  ]);
  await jest.advanceTimersByTimeAsync(SwitchTiming.MIN_SWITCH_MS - 1);
  expect(done).not.toHaveBeenCalled();
  expect(
    emit.mock.calls
      .slice(2)
      .map(call => call[0].state)
      .sort(),
  ).toEqual(['fallback', 'ready']);
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ voice: false, answers: true });
  expect(emit.mock.calls[2][0].switchId).toBe(1);
});
test('a hanging piece falls back at eight seconds and never emits a late ready', async () => {
  const emit = jest.fn();
  let resolve!: (ready: boolean) => void;
  const result = runSwitch(
    2,
    [
      task(
        SwitchPiece.listening,
        () =>
          new Promise(done => {
            resolve = done;
          }),
      ),
    ],
    emit,
  );
  await jest.advanceTimersByTimeAsync(SwitchTiming.PIECE_TIMEOUT_MS);
  expect(await result).toEqual({ listening: false });
  expect(emit).toHaveBeenLastCalledWith({
    switchId: 2,
    piece: 'listening',
    state: 'fallback',
    label: 'fallback',
  });
  resolve(true);
  await Promise.resolve();
  expect(emit).toHaveBeenCalledTimes(2);
});
