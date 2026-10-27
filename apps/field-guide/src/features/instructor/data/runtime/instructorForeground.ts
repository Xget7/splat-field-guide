import { AppStateChange, type AppStatePort } from '../../../../platform/ports';

const BACKGROUND = 'background';

export function createInstructorForeground(activity: AppStatePort) {
  let foreground = activity.currentState !== BACKGROUND;
  let subscription: { remove(): void } | null = null;
  let changed: ((foreground: boolean) => void) | null = null;
  let prompts = 0;
  let currentState = activity.currentState;
  function apply(state: string | null) {
    currentState = state;
    if (prompts > 0 || changed === null) {
      return;
    }
    const next = state !== BACKGROUND;
    if (next !== foreground) {
      foreground = next;
      changed(foreground);
    }
  }
  return {
    isForeground: () => foreground,
    async prompt<T>(request: () => Promise<T>): Promise<T> {
      prompts++;
      try {
        return await request();
      } finally {
        prompts--;
        if (prompts === 0) {
          apply(activity.currentState ?? currentState);
        }
      }
    },
    start(onChanged: (foreground: boolean) => void) {
      if (subscription !== null) {
        return;
      }
      changed = onChanged;
      subscription = activity.addEventListener(AppStateChange, apply);
    },
    stop() {
      subscription?.remove();
      subscription = null;
      changed = null;
    },
  };
}
export type InstructorForeground = ReturnType<
  typeof createInstructorForeground
>;
