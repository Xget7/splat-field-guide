import { VoiceStartFailure } from '../../domain/voice/voiceSession';
import type { Clock } from '../../../../platform/ports';
import type { ProxyClient } from './proxyClient';

export const SIGNED_URL_REUSE_MS = 600000;

/**
 * The agent's signed URLs: one prepared during a switch is reused by the next conversation while
 * it is fresh, and quota or auth disables the agent for the run.
 */
export function createAgentConnection({
  proxy,
  clock: now,
}: {
  proxy: ProxyClient | null;
  clock: Clock;
}) {
  let available = proxy !== null;
  let cached: { url: string; at: number } | null = null;
  let generation = 0;
  async function fetchUrl() {
    if (!available || proxy === null) {
      throw new Error(VoiceStartFailure.auth);
    }
    return proxy.sessionUrl();
  }
  return {
    available: () => available,
    disable() {
      available = false;
      cached = null;
      generation++;
    },
    clear() {
      cached = null;
      generation++;
    },
    async prepare() {
      const id = generation;
      const signed = await fetchUrl();
      if (id === generation && available) {
        cached = { url: signed, at: now() };
      }
    },
    async signedUrl() {
      const prepared = cached;
      cached = null;
      if (prepared && available && now() - prepared.at < SIGNED_URL_REUSE_MS) {
        return prepared.url;
      }
      return fetchUrl();
    },
  };
}
