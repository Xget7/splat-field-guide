import { fetchSignedUrl } from '../features/instructor/agent/agentClient';
import { VoiceStartFailure } from '../features/instructor/voice/voiceSession';

export const SIGNED_URL_REUSE_MS = 600000;
export function createAgentConnection({
  url,
  fetchImpl,
  now = Date.now,
}: {
  url: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  let available = url !== null;
  let cached: { url: string; at: number } | null = null;
  let generation = 0;
  async function fetchUrl() {
    if (!available || url === null) {
      throw new Error(VoiceStartFailure.auth);
    }
    return fetchSignedUrl(url, fetchImpl);
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
