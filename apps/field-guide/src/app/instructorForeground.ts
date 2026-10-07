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
  return {
    isForeground: () => foreground,
    start(changed: (foreground: boolean) => void) {
      if (subscription !== null) {
        return;
      }
      subscription = activity.addEventListener(AppActivity.change, state => {
        const next = state !== AppActivity.background;
        if (next === foreground) {
          return;
        }
        foreground = next;
        changed(foreground);
      });
    },
    stop() {
      subscription?.remove();
      subscription = null;
    },
  };
}
