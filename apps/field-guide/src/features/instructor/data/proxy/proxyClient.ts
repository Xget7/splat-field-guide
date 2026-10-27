import { AgentFailure } from '../../domain/agent/agentStatus';
import type { Cancel, Platform } from '../../../../platform/ports';
import {
  createNdjsonEvents,
  ProxyEventType,
  StreamFailureKind,
} from './ndjsonEvents';
import {
  CONTENT_TYPE_HEADER,
  JSON_CONTENT_TYPE,
  ProxyError,
  ProxyPath,
  ProxyStatus,
} from './proxyContract';

export const PING_TIMEOUT_MS = 3000;
const PING_FAILED = 'Network probe failed';
const POST = 'POST';
const GET = 'GET';

/** Why an answer from the Worker did not complete. */
export const ProxyFailureKind = {
  ...StreamFailureKind,
  status: 'status',
  network: 'network',
  endedEarly: 'endedEarly',
  cancelled: 'cancelled',
} as const;
export type ProxyFailureKind =
  (typeof ProxyFailureKind)[keyof typeof ProxyFailureKind];
const FailureMessage = {
  network: 'network',
  endedEarly: 'stream ended early',
  cancelled: 'cancelled',
  status: (status: number) => `status ${status}`,
} as const;

/** An answer failure keeps its kind beside the message the Worker or the stream gave. */
export type ProxyFailure = Error & { readonly kind: ProxyFailureKind };
function proxyFailure(kind: ProxyFailureKind, message: string): ProxyFailure {
  return Object.assign(new Error(message), { kind });
}

export interface ProxyAnswerRequest {
  readonly system: string;
  readonly prompt: string;
}

/** One streamed answer: its full text once done, and a cancel that rejects it. */
export interface ProxyAnswer {
  readonly text: Promise<string>;
  cancel(): void;
}

export interface ProxyClient {
  /** Streams the answer, reporting the text so far, and rejects with a ProxyFailure. */
  answer(
    request: ProxyAnswerRequest,
    onText: (text: string) => void,
  ): ProxyAnswer;
  /** A signed agent conversation URL, or a rejection naming quota, auth or network. */
  sessionUrl(): Promise<string>;
  /** The round trip to the Worker in milliseconds; the signal aborts a ping that no longer matters. */
  ping(signal?: AbortSignal): Promise<number>;
}

type ProxyPorts = Pick<
  Platform,
  'fetch' | 'clock' | 'timers' | 'streamingRequest'
>;

/** Maps the voice session response to its URL or the failure the agent reports. */
function signedUrlFrom(status: number, body: unknown): string {
  const fields =
    body !== null && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  if (
    status === ProxyStatus.ok &&
    typeof fields.signedUrl === 'string' &&
    fields.signedUrl !== ''
  ) {
    return fields.signedUrl;
  }
  if (
    status === ProxyStatus.rateLimited &&
    fields.error === ProxyError.voiceQuota
  ) {
    throw new Error(AgentFailure.quota);
  }
  // Any 503 disables the agent, including a limiter that is only briefly down.
  if (
    status === ProxyStatus.unavailable ||
    fields.error === ProxyError.voiceAuth
  ) {
    throw new Error(AgentFailure.auth);
  }
  throw new Error(AgentFailure.network);
}

/** The instructor Worker at one base URL; the Worker keeps the API keys. */
export function createProxyClient(
  baseUrl: string,
  ports: ProxyPorts,
): ProxyClient {
  const { clock, timers } = ports;
  return {
    answer({ system, prompt }, onText) {
      const request = ports.streamingRequest();
      const events = createNdjsonEvents();
      let text = '';
      let read = 0;
      let settled = false;
      let resolve!: (text: string) => void;
      let reject!: (failure: ProxyFailure) => void;
      const answered = new Promise<string>((done, failed) => {
        resolve = done;
        reject = failed;
      });
      const fail = (kind: ProxyFailureKind, message: string) => {
        if (!settled) {
          settled = true;
          request.abort();
          reject(proxyFailure(kind, message));
        }
      };
      const receive = () => {
        if (settled || request.status !== ProxyStatus.ok) {
          return;
        }
        const body = request.responseText;
        const chunk = body.slice(read);
        read = body.length;
        for (const event of events.feed(chunk)) {
          if (settled) {
            return;
          }
          if (event.type === ProxyEventType.text) {
            text += event.text;
            onText(text);
          } else if (event.type === ProxyEventType.done) {
            settled = true;
            resolve(text);
          } else {
            fail(event.kind, event.message);
          }
        }
      };
      request.onprogress = receive;
      request.onload = () => {
        if (request.status !== ProxyStatus.ok) {
          fail(ProxyFailureKind.status, FailureMessage.status(request.status));
          return;
        }
        receive();
        fail(ProxyFailureKind.endedEarly, FailureMessage.endedEarly);
      };
      request.onerror = () =>
        fail(ProxyFailureKind.network, FailureMessage.network);
      request.open(POST, `${baseUrl}${ProxyPath.answer}`);
      request.setRequestHeader(CONTENT_TYPE_HEADER, JSON_CONTENT_TYPE);
      request.send(JSON.stringify({ system, prompt }));
      return {
        text: answered,
        cancel: () =>
          fail(ProxyFailureKind.cancelled, FailureMessage.cancelled),
      };
    },
    async sessionUrl() {
      let response: Response;
      let body: unknown;
      try {
        response = await ports.fetch(`${baseUrl}${ProxyPath.voiceSession}`, {
          method: POST,
        });
        try {
          body = await response.json();
        } catch {
          body = null;
        }
      } catch {
        throw new Error(AgentFailure.network);
      }
      return signedUrlFrom(response.status, body);
    },
    async ping(signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort);
      const began = clock();
      let cancelTimeout: Cancel | undefined;
      try {
        return await Promise.race([
          ports
            .fetch(`${baseUrl}${ProxyPath.ping}`, {
              method: GET,
              signal: controller.signal,
            })
            .then(response => {
              if (response.status !== ProxyStatus.noContent) {
                throw new Error(PING_FAILED);
              }
              return clock() - began;
            }),
          new Promise<never>((_, rejectPing) => {
            cancelTimeout = timers.after(PING_TIMEOUT_MS, () => {
              controller.abort();
              rejectPing(new Error(PING_FAILED));
            });
          }),
        ]);
      } finally {
        cancelTimeout?.();
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
