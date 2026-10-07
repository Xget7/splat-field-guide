import type { Env } from "./index.ts";
import { Header, NO_STORE, errorResponse, limitRequest } from "./http.ts";

const SIGNED_URL_ENDPOINT = "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url";
const VoiceError = {
  notConfigured: "voice not configured",
  auth: "voice auth",
  quota: "voice quota",
  unavailable: "voice unavailable",
} as const;

export async function handleVoiceSession(request: Request, env: Env): Promise<Response> {
  const limited = await limitRequest(request, env);
  if (limited) return limited;
  if (!env.ELEVENLABS_API_KEY || !env.AGENT_ID) {
    return errorResponse(503, VoiceError.notConfigured);
  }

  try {
    const url = new URL(SIGNED_URL_ENDPOINT);
    url.searchParams.set("agent_id", env.AGENT_ID);
    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: { [Header.voiceKey]: env.ELEVENLABS_API_KEY },
      signal: request.signal,
    });
    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => {});
      if (upstream.status === 401 || upstream.status === 403) return errorResponse(502, VoiceError.auth);
      if (upstream.status === 429) return errorResponse(429, VoiceError.quota);
      return errorResponse(502, VoiceError.unavailable);
    }
    const body = await upstream.json() as { signed_url?: unknown } | null;
    if (typeof body?.signed_url !== "string" || !body.signed_url.trim()) {
      return errorResponse(502, VoiceError.unavailable);
    }
    return Response.json({ signedUrl: body.signed_url }, { headers: { [Header.cacheControl]: NO_STORE } });
  } catch {
    return errorResponse(502, VoiceError.unavailable);
  }
}
