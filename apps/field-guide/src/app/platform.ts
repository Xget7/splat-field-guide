import { AppState } from 'react-native';
import {
  audioLink,
  languageModel,
  networkMonitor,
  speechInput,
  speechOutput,
} from 'react-native-on-device';
import type { Platform, Socket, StreamingRequest } from '../platform/ports';

/** The production ports: React Native, the on-device native modules and the JavaScript globals. */
export function createPlatform(): Platform {
  return {
    clock: () => Date.now(),
    timers: {
      after(delayMs, run) {
        const timer = setTimeout(run, delayMs);
        return () => clearTimeout(timer);
      },
      every(intervalMs, run) {
        const timer = setInterval(run, intervalMs);
        return () => clearInterval(timer);
      },
    },
    speechInput,
    speechOutput,
    audioLink,
    languageModel,
    // The native monitor is created on first use, so importing the platform never touches it.
    networkMonitor: {
      start: onChange => networkMonitor().start(onChange),
      stop: () => networkMonitor().stop(),
    },
    fetch: (input, init) => fetch(input, init),
    // Looked up per request: the global only exists where React Native installs it. Both casts
    // narrow the DOM types to the members the ports use, whose handlers ignore the event.
    streamingRequest: () => new XMLHttpRequest() as unknown as StreamingRequest,
    socket: url => new WebSocket(url) as unknown as Socket,
    random: () => Math.random(),
    appState: {
      get currentState() {
        return AppState.currentState ?? null;
      },
      addEventListener: (event, listener) =>
        AppState.addEventListener(event, state => {
          if (state !== undefined) {
            listener(state);
          }
        }),
    },
  };
}
