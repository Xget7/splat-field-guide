import type { AppStateStatus } from 'react-native';
import { createInstructorForeground } from '../apps/field-guide/src/app/instructorForeground';

test('applies a real background only after the last system prompt settles, even on rejection', async () => {
  let state: AppStateStatus = 'active';
  let change!: (state: AppStateStatus) => void;
  const foreground = createInstructorForeground({
    get currentState() {
      return state;
    },
    addEventListener: (_event, listener) => {
      change = listener;
      return { remove: jest.fn() };
    },
  });
  const changed = jest.fn();
  foreground.start(changed);
  let settle!: () => void;
  let reject!: (error: Error) => void;
  const first = foreground.prompt(
    () =>
      new Promise<void>(resolve => {
        settle = resolve;
      }),
  );
  const last = foreground.prompt(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  state = 'background';
  change(state);
  settle();
  await first;
  expect(foreground.isForeground()).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  reject(new Error('Prompt failed'));
  await expect(last).rejects.toThrow('Prompt failed');
  expect(foreground.isForeground()).toBe(false);
  expect(changed.mock.calls).toEqual([[false]]);
  foreground.stop();
});
