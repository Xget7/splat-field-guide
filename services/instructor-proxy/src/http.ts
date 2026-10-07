import type { Env } from "./index.ts";

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
// Requests without Cloudflare's IP header share a bucket instead of bypassing it.
const UNKNOWN_CLIENT = "unknown";

export const ContentType = {
  json: "application/json",
  ndjson: "application/x-ndjson; charset=utf-8",
  sse: "text/event-stream; charset=utf-8",
} as const;
export const NO_STORE = "no-store";
export const Header = {
  clientIp: "CF-Connecting-IP",
  authorization: "authorization",
  contentType: "content-type",
  cacheControl: "cache-control",
  anthropicKey: "x-api-key",
  anthropicVersion: "anthropic-version",
  voiceKey: "xi-api-key",
} as const;

export const RequestError = {
  notFound: "not found",
  method: "method not allowed",
  rateLimited: "rate limit exceeded",
  limiterDown: "rate limiter unavailable",
  invalidJson: "invalid JSON",
  notObject: "expected JSON object",
  fields: "system and prompt must be non-empty strings",
  systemTooLong: "system too long",
  promptTooLong: "prompt too long",
  missingKey: "missing API key",
  upstreamDown: "upstream unavailable",
  noUpstreamStream: "missing upstream stream",
} as const;

export function errorResponse(status: number, error: string, headers = {}) {
  return Response.json(
    { error },
    { status, headers: { [Header.cacheControl]: NO_STORE, ...headers } },
  );
}

export async function limitRequest(request: Request, env: Env): Promise<Response | undefined> {
  try {
    const key = request.headers.get(Header.clientIp) || UNKNOWN_CLIENT;
    const { success } = await env.LIMITER.limit({ key });
    if (!success) return errorResponse(429, RequestError.rateLimited);
  } catch {
    return errorResponse(503, RequestError.limiterDown);
  }
}
