import { AppState } from 'react-native';
import {
  audioLink,
  languageModel,
  networkMonitor,
  speechInput,
  speechOutput,
} from 'react-native-on-device';
import type { Platform, Socket } from '../platform/ports';
import { streamTextOverXhr } from './xhrTextStream';

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
    streamText: streamTextOverXhr,
    // Looked up per socket: the global only exists where React Native installs it. The cast
    // narrows the DOM type to the members the port uses, whose handlers ignore the event.
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
