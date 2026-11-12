import { handleVoiceSession } from './voice.ts';
import { Header, NO_STORE, RequestError, errorResponse } from './http.ts';
export interface Env {
  ELEVENLABS_API_KEY: string;
  AGENT_ID: string;
  LIMITER: RateLimit;
}
/** Public, rate-limited pilot issuer. This does not establish operator identity or membership. */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = path === '/v1/ping' ? 'GET' : path === '/v1/voice/session' ? 'POST' : null;
  if (!method) return errorResponse(404, RequestError.notFound);
  if (request.method !== method) return errorResponse(405, RequestError.method, { allow: method });
  if (path === '/v1/ping') return new Response(null, { status: 204, headers: { [Header.cacheControl]: NO_STORE } });
  return handleVoiceSession(request, env);
}
export default { fetch: handleRequest } satisfies ExportedHandler<Env>;
