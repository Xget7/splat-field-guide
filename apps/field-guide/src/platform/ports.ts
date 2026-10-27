import type { AppStateStatus } from 'react-native';
import type {
  AudioLinkSpec,
  LanguageModelSpec,
  SpeechInputSpec,
  SpeechOutputSpec,
} from 'react-native-on-device';
import type { PathInfo } from './connectivity/networkQuality';

/** Cancels a scheduled run; calling it after the run or twice does nothing. */
export type Cancel = () => void;

/** Reads the current time in milliseconds since the epoch. */
export type Clock = () => number;

/** Schedules work later, each call returning the function that cancels it. */
export interface Timers {
  after(delayMs: number, run: () => void): Cancel;
  every(intervalMs: number, run: () => void): Cancel;
}

/** Recognises speech: permission, locale preparation and installation, continuous listening and cancel. */
export type SpeechInput = Pick<
  SpeechInputSpec,
  'requestPermission' | 'prepare' | 'install' | 'listen' | 'cancel'
>;

/** Speaks text with word timing, prepares a voice and stops output. */
export type SpeechOutput = Pick<SpeechOutputSpec, 'prepare' | 'speak' | 'stop'>;

/** Streams microphone audio out and plays conversation audio in, with its permission. */
export type AudioLink = Pick<
  AudioLinkSpec,
  'requestPermission' | 'start' | 'play' | 'clear' | 'playedMs' | 'stop'
>;

/** Sends one HTTP request and resolves with its response. */
export type Fetch = typeof fetch;

/** Returns a number in [0, 1), spreading retries so clients do not retry in step. */
export type Random = () => number;

/** Generates answers on the device when the model is available. */
export type LanguageModel = Pick<
  LanguageModelSpec,
  'availability' | 'prewarm' | 'respond' | 'cancel'
>;

/** Reports the current network route, then every change, to one listener. */
export interface NetworkMonitor {
  start(onChange: (path: PathInfo) => void): void;
  stop(): void;
}

/** One streaming POST whose response text grows as it arrives, shaped like XMLHttpRequest. */
export interface StreamingRequest {
  readonly status: number;
  readonly responseText: string;
  onprogress: (() => void) | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: string): void;
  abort(): void;
}

/** One open conversation socket, shaped like WebSocket. */
export interface Socket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

/** Keeps small strings across launches, shaped like AsyncStorage. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The one app state event the instructor follows. */
export const AppStateChange = 'change';

/** The app's foreground state and its changes. */
export interface AppStatePort {
  readonly currentState: string | null;
  addEventListener(
    event: typeof AppStateChange,
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
}

/**
 * Every capability the app reaches outside JavaScript, built once at startup.
 * Speech, audio and the language model are factories because their native objects are created on first use.
 */
export interface Platform {
  readonly clock: Clock;
  readonly timers: Timers;
  readonly speechInput: () => SpeechInput;
  readonly speechOutput: () => SpeechOutput;
  readonly audioLink: () => AudioLink;
  readonly languageModel: () => LanguageModel;
  readonly networkMonitor: NetworkMonitor;
  readonly fetch: Fetch;
  readonly streamingRequest: () => StreamingRequest;
  readonly socket: (url: string) => Socket;
  readonly random: Random;
  readonly appState: AppStatePort;
}
