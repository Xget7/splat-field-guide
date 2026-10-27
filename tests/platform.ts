import type { AppStateStatus } from 'react-native';
import type { PathInfo } from '../apps/field-guide/src/platform/connectivity/networkQuality';
import { createChunkChannel } from '../apps/field-guide/src/platform/chunkChannel';
import {
  ABORT_ERROR_NAME,
  ABORT_EVENT,
  type AppStatePort,
  type AudioLink,
  type LanguageModel,
  type Platform,
  type Socket,
  type SpeechInput,
  type SpeechOutput,
  type StreamText,
} from '../apps/field-guide/src/platform/ports';
import type { KeyValueStorage } from '../apps/field-guide/src/platform/storage';

const ACTIVE: AppStateStatus = 'active';
// Backoff jitter stays centred, so timed tests land on exact delays.
const CENTRED_RANDOM = 0.5;
const UNSCRIPTED_FETCH = 'The fake platform has no scripted fetch';
const UNSCRIPTED_STREAM = 'The fake platform has no scripted text stream';
const TRANSPORT_FAILED = 'The fake transport failed';
const ABORTED = 'The fake request was aborted';
const NOT_MONITORING = 'The network monitor has not started';
const HTTP_OK = 200;

export const AGENT_METADATA = {
  type: 'conversation_initiation_metadata',
  conversation_initiation_metadata_event: {
    conversation_id: 'conversation',
    user_input_audio_format: 'pcm_16000',
    agent_output_audio_format: 'pcm_24000',
  },
};

/** Agent sockets the test opens, answers and closes. */
export function fakeAgentTransport() {
  const sockets: Socket[] = [];
  const closed = new Set<Socket>();
  const sent: unknown[] = [];
  return {
    connect(): Socket {
      const socket: Socket = {
        send: data => sent.push(JSON.parse(data)),
        close: () => {
          closed.add(socket);
        },
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
      };
      sockets.push(socket);
      return socket;
    },
    receive(message: unknown) {
      sockets.at(-1)?.onmessage?.({ data: JSON.stringify(message) });
    },
    ready() {
      sockets.at(-1)?.onopen?.();
      this.receive(AGENT_METADATA);
    },
    get current() {
      return sockets.at(-1)!;
    },
    get connections() {
      return sockets.length;
    },
    get open() {
      return sockets.filter(socket => !closed.has(socket)).length;
    },
    sent,
  };
}

/** One streamed request the test answers chunk by chunk, recording what was sent. */
export interface FakeTextStream {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly aborted: boolean;
  /** Opens the response with an OK status if it is not open yet, then delivers the text. */
  receive(chunk: string): void;
  /** Opens the response with a status if it is not open yet, then completes it. */
  end(status?: number): void;
  /** Fails the request before its headers, or the open response mid-stream, as the transport does. */
  fail(): void;
}

/** Text streams the test answers; pass `streamText` as the platform's streamText. */
export function fakeTextStreams() {
  const streams: FakeTextStream[] = [];
  const streamText: StreamText = ({ signal, ...request }) =>
    new Promise((resolve, reject) => {
      const channel = createChunkChannel();
      let opened = false;
      const open = (status: number) => {
        if (!opened) {
          opened = true;
          resolve({ status, chunks: channel.chunks });
        }
      };
      const fail = (error: Error) =>
        opened ? channel.fail(error) : reject(error);
      const stream = {
        ...request,
        aborted: false,
        receive(chunk: string) {
          open(HTTP_OK);
          channel.push(chunk);
        },
        end(status = HTTP_OK) {
          open(status);
          channel.end();
        },
        fail: () => fail(new Error(TRANSPORT_FAILED)),
      };
      signal?.addEventListener(ABORT_EVENT, () => {
        stream.aborted = true;
        fail(Object.assign(new Error(ABORTED), { name: ABORT_ERROR_NAME }));
      });
      streams.push(stream);
    });
  return {
    streamText,
    get last() {
      return streams.at(-1)!;
    },
    get count() {
      return streams.length;
    },
  };
}

/**
 * Key-value storage in memory. Its methods are jest functions a test can script, and
 * `delayNextWrite` holds the next set or remove until the returned release is called.
 */
export function fakeStorage() {
  const items = new Map<string, string>();
  let held: Promise<void> | null = null;
  async function write(apply: () => void) {
    const wait = held;
    held = null;
    await wait;
    apply();
  }
  const storage = {
    getItem: jest.fn<Promise<string | null>, [string]>(
      async key => items.get(key) ?? null,
    ),
    setItem: jest.fn<Promise<void>, [string, string]>((key, value) =>
      write(() => items.set(key, value)),
    ),
    removeItem: jest.fn<Promise<void>, [string]>(key =>
      write(() => items.delete(key)),
    ),
  } satisfies KeyValueStorage;
  return {
    storage,
    items,
    delayNextWrite(): () => void {
      let release!: () => void;
      held = new Promise(resolve => {
        release = resolve;
      });
      return release;
    },
  };
}

/** An app state the test moves between foreground and background. */
function fakeAppState(initial: string) {
  let current: string | null = initial;
  const listeners = new Set<(state: AppStateStatus) => void>();
  const port: AppStatePort = {
    get currentState() {
      return current;
    },
    addEventListener(_event, listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return {
    port,
    /** Sets the current state and reports it, as the system does. */
    change(state: AppStateStatus) {
      current = state;
      [...listeners].forEach(listener => listener(state));
    },
  };
}

/** A network monitor the test feeds routes. */
function fakeNetworkMonitor() {
  let listener: ((path: PathInfo) => void) | null = null;
  const monitor = {
    start: jest.fn((onChange: (path: PathInfo) => void) => {
      listener = onChange;
    }),
    stop: jest.fn(() => {
      listener = null;
    }),
  };
  return {
    monitor,
    emit(path: PathInfo) {
      if (listener === null) {
        throw new Error(NOT_MONITORING);
      }
      listener(path);
    },
  };
}

export interface FakePlatformOptions
  extends Partial<Omit<Platform, 'appState'>> {
  readonly initialAppState?: AppStateStatus;
}

/**
 * The one test platform: native capabilities are jest functions each test scripts, and the clock
 * and timers read the globals at call time, so jest fake timers drive them.
 */
export function fakePlatform(options: FakePlatformOptions = {}) {
  const { initialAppState = ACTIVE, ...overrides } = options;
  const input = {
    requestPermission: jest.fn<
      ReturnType<SpeechInput['requestPermission']>,
      []
    >(async () => 'granted'),
    prepare: jest.fn<ReturnType<SpeechInput['prepare']>, [string]>(
      async () => 'available',
    ),
    install: jest.fn<ReturnType<SpeechInput['install']>, [string]>(
      async () => 'available',
    ),
    listen: jest.fn<
      ReturnType<SpeechInput['listen']>,
      Parameters<SpeechInput['listen']>
    >(async () => {}),
    cancel: jest.fn(),
  } satisfies SpeechInput;
  const output = {
    prepare: jest.fn<
      ReturnType<SpeechOutput['prepare']>,
      Parameters<SpeechOutput['prepare']>
    >(async voice => voice),
    speak: jest.fn<
      ReturnType<SpeechOutput['speak']>,
      Parameters<SpeechOutput['speak']>
    >(async () => {}),
    stop: jest.fn(),
  } satisfies SpeechOutput;
  const link = {
    requestPermission: jest.fn<Promise<boolean>, []>(async () => true),
    start: jest.fn<
      ReturnType<AudioLink['start']>,
      Parameters<AudioLink['start']>
    >(async () => {}),
    play: jest.fn<void, [string]>(),
    clear: jest.fn(),
    playedMs: jest.fn(() => 0),
    stop: jest.fn(),
  } satisfies AudioLink;
  const model = {
    availability: jest.fn<ReturnType<LanguageModel['availability']>, []>(
      () => 'unavailable',
    ),
    prewarm: jest.fn<void, [string]>(),
    respond: jest.fn<
      ReturnType<LanguageModel['respond']>,
      Parameters<LanguageModel['respond']>
    >(),
    cancel: jest.fn(),
  } satisfies LanguageModel;
  const appState = fakeAppState(initialAppState);
  const network = fakeNetworkMonitor();
  const transport = fakeAgentTransport();
  const platform: Platform = {
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
    speechInput: () => input,
    speechOutput: () => output,
    audioLink: () => link,
    languageModel: () => model,
    networkMonitor: network.monitor,
    fetch: jest.fn(async () => {
      throw new Error(UNSCRIPTED_FETCH);
    }),
    streamText: async () => {
      throw new Error(UNSCRIPTED_STREAM);
    },
    socket: transport.connect,
    random: () => CENTRED_RANDOM,
    ...overrides,
    appState: appState.port,
  };
  return {
    platform,
    input,
    output,
    link,
    model,
    transport,
    network,
    appState,
    /** Reports a microphone level to the latest listen call. */
    emitLevel: (level: number) => input.listen.mock.calls.at(-1)?.[4]?.(level),
    /** Reports a spoken word range to the latest speak call. */
    emitWord: (location: number, length: number) =>
      output.speak.mock.calls.at(-1)?.[2]?.(location, length),
  };
}
