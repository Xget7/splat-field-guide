import { AppState, type AppStateStatus } from 'react-native';

const AppActivity = { background: 'background', change: 'change' } as const;
export interface AppStatePort {
  readonly currentState: string | null;
  addEventListener(
    event: typeof AppActivity.change,
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
}
const nativeAppState: AppStatePort = {
  get currentState() {
    return AppState.currentState ?? null;
  },
  addEventListener: (event, listener) =>
    AppState.addEventListener(event, state => {
      if (state !== undefined) {
        listener(state);
      }
    }),
};

export function createInstructorForeground(activity = nativeAppState) {
  let foreground = activity.currentState !== AppActivity.background;
  let subscription: { remove(): void } | null = null;
  let changed: ((foreground: boolean) => void) | null = null;
  let prompts = 0;
  let currentState = activity.currentState;
  function apply(state: string | null) {
    currentState = state;
    if (prompts > 0 || changed === null) {
      return;
    }
    const next = state !== AppActivity.background;
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
      subscription = activity.addEventListener(AppActivity.change, apply);
    },
    stop() {
      subscription?.remove();
      subscription = null;
      changed = null;
    },
  };
}
