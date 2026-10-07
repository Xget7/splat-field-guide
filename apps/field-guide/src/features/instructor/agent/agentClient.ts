import { AgentFailure, AgentState, type AgentStatus } from '../../events/types';
import type { WordRange } from '../voice/speechPresentation';
import type { AgentVariables } from './agentVariables';
import {
  ClientMessage,
  parseServerMessage,
  type AgentServerEvent,
} from './agentProtocol';
import { chunkDurationMs, createWordTimeline } from './wordTimeline';
import {
  closeFailure,
  clientFailure,
  connectionFailure,
  sessionUrl,
} from './agentFailure';
import { AgentToolCopy } from './agentCopy';

export const AgentAudio = { INPUT_RATE: 16000, OUTPUT_RATE: 24000 } as const;
export const AgentTiming = {
  CONNECT_TIMEOUT_MS: 8000,
  WORD_TICK_MS: 50,
} as const;

/** Mirrors the native AudioLink. */
export interface AudioPort {
  start(
    inputRate: number,
    outputRate: number,
    onInput: (chunk: string) => void,
    onLevel: (level: number) => void,
    onStopped: (reason: string) => void,
  ): Promise<void>;
  play(chunk: string): void;
  clear(): void;
  playedMs(): number;
  stop(): void;
}

export interface SocketPort {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

export const AgentEnd = {
  silence: 'silence',
  stopped: 'stopped',
  network: 'network',
  quota: 'quota',
  auth: 'auth',
  audio: 'audio',
  error: 'error',
} as const;
export type AgentEnd = (typeof AgentEnd)[keyof typeof AgentEnd];

export interface AgentClientHandlers {
  status(status: AgentStatus): void;
  userTranscript(text: string): void;
  /** Cumulative text of the current response. */
  responseText(text: string): void;
  response(text: string): void;
  correction(corrected: string): void;
  interruption(): void;
  /** The response's audio started or finished playing. */
  speaking(speaking: boolean): void;
  word(range: WordRange | null): void;
  level(level: number): void;
  toolCall(
    name: string,
    parameters: unknown,
  ): { result: string; isError: boolean };
  roundTrip(ms: number): void;
  ended(reason: AgentEnd): void;
}

export interface AgentClientOptions {
  /** Resolves the signed URL or rejects with an Error whose message is an AgentFailure. */
  readonly signedUrl: () => Promise<string>;
  readonly connect: (url: string) => SocketPort;
  readonly audio: AudioPort;
  readonly handlers: AgentClientHandlers;
  readonly setInterval?: typeof setInterval;
  readonly clearInterval?: typeof clearInterval;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
}

export interface AgentClient {
  /** Resolves once connected and the microphone streams; rejects with an Error whose message is an AgentFailure. */
  start(variables: AgentVariables, context: readonly string[]): Promise<void>;
  sendText(text: string): void;
  sendContext(text: string): void;
  setMuted(muted: boolean): void;
  /** Drops the current response locally: clears audio and ignores its audio and text until the next response starts. */
  interrupt(): void;
  stop(): void;
}

const NO_EVENT_ID = -1;
const NEXT_EVENT_ID = 1;
export function createAgentClient(options: AgentClientOptions): AgentClient {
  const { audio, handlers } = options;
  const schedule = options.setTimeout ?? setTimeout;
  const cancel = options.clearTimeout ?? clearTimeout;
  const repeat = options.setInterval ?? setInterval;
  const cancelRepeat = options.clearInterval ?? clearInterval;
  let socket: SocketPort | null = null;
  let running = false;
  let connected = false;
  let muted = false;
  let generation = 0;
  let rejectStart: ((error: Error) => void) | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let timeline = createWordTimeline();
  let queuedMs = 0;
  let playbackStartMs = 0;
  let speaking = false;
  let responseText = '';
  let lastInterruptionId = NO_EVENT_ID;
  let currentEventId = NO_EVENT_ID;
  let responseEventId: number | null = null;
  function finishSpeaking() {
    if (tick !== null) {
      cancelRepeat(tick);
      tick = null;
    }
    handlers.word(null);
    if (speaking) {
      speaking = false;
      handlers.speaking(false);
    }
  }
  function resetResponse() {
    finishSpeaking();
    timeline = createWordTimeline();
    queuedMs = 0;
    responseText = '';
    responseEventId = null;
  }
  function acceptResponse(eventId: number): boolean {
    if (eventId < lastInterruptionId) {
      return false;
    }
    if (responseEventId !== eventId) {
      resetResponse();
      responseEventId = eventId;
    }
    return true;
  }
  function end(
    reason: AgentEnd,
    startFailure: AgentFailure = AgentFailure.unknown,
  ) {
    if (!running) {
      return;
    }
    running = false;
    connected = false;
    generation++;
    if (timeout !== null) {
      cancel(timeout);
      timeout = null;
    }
    const previous = socket;
    socket = null;
    if (previous) {
      previous.onopen = null;
      previous.onmessage = null;
      previous.onerror = null;
      previous.onclose = null;
    }
    resetResponse();
    audio.stop();
    try {
      previous?.close();
    } catch {
      /* Teardown is complete even when the transport cannot close. */
    }
    const failure =
      reason === AgentEnd.quota
        ? AgentFailure.quota
        : reason === AgentEnd.auth
        ? AgentFailure.auth
        : reason === AgentEnd.network
        ? AgentFailure.network
        : null;
    const pending = rejectStart;
    rejectStart = null;
    pending?.(new Error(failure ?? startFailure));
    handlers.status({
      state: failure ? AgentState.failed : AgentState.ended,
      reason: failure,
    });
    handlers.ended(reason);
  }
  function endFailure(failure: AgentFailure) {
    end(
      failure === AgentFailure.quota
        ? AgentEnd.quota
        : failure === AgentFailure.auth
        ? AgentEnd.auth
        : failure === AgentFailure.network
        ? AgentEnd.network
        : AgentEnd.error,
    );
  }
  function send(message: string) {
    if (!running || !socket) {
      return;
    }
    try {
      socket.send(message);
    } catch {
      end(AgentEnd.network);
    }
  }
  function words() {
    const played = Math.max(0, audio.playedMs() - playbackStartMs);
    if (played >= queuedMs) {
      finishSpeaking();
    } else {
      const range = timeline.wordAt(played);
      const length = range
        ? Math.min(range.length, responseText.length - range.location)
        : 0;
      handlers.word(
        range && length > 0 ? { location: range.location, length } : null,
      );
    }
  }
  function receive(event: AgentServerEvent) {
    switch (event.type) {
      case 'metadata':
        break;
      case 'userTranscript':
        handlers.userTranscript(event.text);
        break;
      case 'responsePart':
        if (acceptResponse(event.eventId)) {
          responseText =
            event.part === 'start' ? event.text : responseText + event.text;
          timeline.replaceText(responseText);
          handlers.responseText(responseText);
          words();
        }
        break;
      case 'response':
        if (acceptResponse(event.eventId)) {
          currentEventId = event.eventId;
          responseText = event.text;
          timeline.replaceText(responseText);
          handlers.response(event.text);
          words();
        }
        break;
      case 'correction':
        if (event.eventId >= lastInterruptionId) {
          responseText = event.corrected;
          timeline.replaceText(responseText);
          handlers.correction(event.corrected);
          words();
        }
        break;
      case 'responseComplete':
        break;
      case 'audio': {
        if (!acceptResponse(event.eventId)) {
          return;
        }
        currentEventId = event.eventId;
        if (queuedMs === 0) {
          playbackStartMs = audio.playedMs();
        }
        if (event.alignment) {
          timeline.add(event.alignment, queuedMs);
        }
        queuedMs += chunkDurationMs(event.audio, AgentAudio.OUTPUT_RATE);
        audio.play(event.audio);
        if (queuedMs > 0 && !speaking) {
          speaking = true;
          handlers.speaking(true);
        }
        if (queuedMs > 0 && tick === null) {
          tick = repeat(words, AgentTiming.WORD_TICK_MS);
        }
        break;
      }
      case 'interruption':
        lastInterruptionId = event.eventId;
        audio.clear();
        resetResponse();
        handlers.interruption();
        break;
      case 'ping':
        send(ClientMessage.pong(event.eventId));
        if (event.pingMs !== null) {
          handlers.roundTrip(event.pingMs);
        }
        break;
      case 'toolCall': {
        let result: { result: string; isError: boolean };
        try {
          result = handlers.toolCall(event.name, event.parameters);
        } catch {
          result = { result: AgentToolCopy.failed, isError: true };
        }
        if (event.expectsResponse) {
          send(
            ClientMessage.toolResult(event.id, result.result, result.isError),
          );
        }
        break;
      }
      case 'error':
        endFailure(clientFailure(event.code, event.name, event.message));
        break;
    }
  }
  return {
    start(variables, context) {
      if (running) {
        return Promise.reject(new Error(AgentFailure.unknown));
      }
      running = true;
      connected = false;
      muted = false;
      lastInterruptionId = NO_EVENT_ID;
      currentEventId = NO_EVENT_ID;
      const currentGeneration = ++generation;
      const current = () => running && generation === currentGeneration;
      handlers.status({ state: AgentState.connecting, reason: null });
      return new Promise<void>((resolve, reject) => {
        rejectStart = reject;
        timeout = schedule(
          () => end(AgentEnd.network),
          AgentTiming.CONNECT_TIMEOUT_MS,
        );
        async function open() {
          try {
            const url = await options.signedUrl();
            if (!current()) {
              return;
            }
            socket = options.connect(url);
            const opened = socket;
            opened.onopen = () => {
              if (!current()) {
                return;
              }
              send(ClientMessage.initiation(variables));
              for (const text of context) {
                if (current()) {
                  send(ClientMessage.contextualUpdate(text));
                }
              }
              if (!current()) {
                return;
              }
              audio
                .start(
                  AgentAudio.INPUT_RATE,
                  AgentAudio.OUTPUT_RATE,
                  chunk => {
                    if (current() && !muted) {
                      send(ClientMessage.audio(chunk));
                    }
                  },
                  level => {
                    if (current()) {
                      handlers.level(level);
                    }
                  },
                  () => {
                    if (current()) {
                      end(AgentEnd.audio);
                    }
                  },
                )
                .then(() => {
                  if (!current()) {
                    return;
                  }
                  connected = true;
                  if (timeout !== null) {
                    cancel(timeout);
                    timeout = null;
                  }
                  rejectStart = null;
                  handlers.status({
                    state: AgentState.connected,
                    reason: null,
                  });
                  resolve();
                })
                .catch(() => {
                  if (current()) {
                    end(AgentEnd.audio);
                  }
                });
            };
            opened.onmessage = event => {
              if (!current() || typeof event.data !== 'string') {
                return;
              }
              const parsed = parseServerMessage(event.data);
              if (parsed) {
                receive(parsed);
              }
            };
            opened.onerror = () => {
              if (current()) {
                end(AgentEnd.network);
              }
            };
            opened.onclose = event => {
              if (!current()) {
                return;
              }
              const failure = closeFailure(event.code, event.reason);
              if (failure) {
                endFailure(failure);
              } else {
                end(AgentEnd.silence);
              }
            };
          } catch (error) {
            if (!current()) {
              return;
            }
            endFailure(connectionFailure(error));
          }
        }
        open();
      });
    },
    sendText(text) {
      if (connected) {
        send(ClientMessage.userMessage(text));
      }
    },
    sendContext(text) {
      if (connected) {
        send(ClientMessage.contextualUpdate(text));
      }
    },
    setMuted(value) {
      muted = value;
    },
    interrupt() {
      if (!running) {
        return;
      }
      lastInterruptionId = Math.max(
        lastInterruptionId,
        currentEventId + NEXT_EVENT_ID,
      );
      audio.clear();
      resetResponse();
    },
    stop() {
      end(AgentEnd.stopped);
    },
  };
}
const VOICE_SESSION_PATH = '/v1/voice/session';
export async function fetchSignedUrl(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  let body: unknown;
  try {
    response = await fetchImpl(`${baseUrl}${VOICE_SESSION_PATH}`, {
      method: 'POST',
    });
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } catch {
    throw new Error(AgentFailure.network);
  }
  return sessionUrl(response.status, body);
}
