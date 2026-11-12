import { AgentFailure } from '../../domain/agent/agentStatus';
import {
  ABORT_EVENT,
  type Cancel,
  type Platform,
} from '../../../../platform/ports';
import { ProxyError, ProxyPath, ProxyStatus } from './proxyContract';

export const PING_TIMEOUT_MS = 3000;
const PING_FAILED = 'Network probe failed';
const POST = 'POST';
const GET = 'GET';

export interface ProxyClient {
  /** A signed agent conversation URL, or a rejection naming quota, auth or network. */
  sessionUrl(): Promise<string>;
  /** The round trip to the Worker in milliseconds; the signal aborts a ping that no longer matters. */
  ping(signal?: AbortSignal): Promise<number>;
}

type ProxyPorts = Pick<Platform, 'fetch' | 'clock' | 'timers'>;

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
  // Only configuration and credential failures disable voice for the run.
  if (
    (status === ProxyStatus.unavailable &&
      fields.error === ProxyError.voiceNotConfigured) ||
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
      signal?.addEventListener(ABORT_EVENT, abort);
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
        signal?.removeEventListener(ABORT_EVENT, abort);
      }
    },
  };
}
