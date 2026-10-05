import { sseToNdjson } from "./stream.ts";

const ANSWER_PATH = "/v1/answer";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_SYSTEM_CHARS = 60000;
const MAX_PROMPT_CHARS = 6000;
// Thinking and the answer share this ceiling; exhausting it fails the stream so the app can fall back.
const MAX_OUTPUT_TOKENS = 1500;
// Requests without Cloudflare's IP header share a bucket instead of bypassing it.
const UNKNOWN_CLIENT = "unknown";

const ContentType = {
  json: "application/json",
  ndjson: "application/x-ndjson; charset=utf-8",
} as const;
const NO_STORE = "no-store";

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

export interface Env {
  ANTHROPIC_API_KEY: string;
  MODEL: string;
  /** How hard the model reasons before answering: low, medium or high. */
  EFFORT: string;
  LIMITER: RateLimit;
}

export interface AnswerInput {
  system: string;
  prompt: string;
}

interface ValidationError {
  status: 400 | 413;
  error: string;
}

export function validateInput(value: unknown): AnswerInput | ValidationError {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: 400, error: RequestError.notObject };
  }

  const { system, prompt } = value as Record<string, unknown>;
  if (typeof system !== "string" || typeof prompt !== "string") {
    return { status: 400, error: RequestError.fields };
  }
  if (system.length > MAX_SYSTEM_CHARS) return { status: 413, error: RequestError.systemTooLong };
  if (prompt.length > MAX_PROMPT_CHARS) return { status: 413, error: RequestError.promptTooLong };
  if (!system.trim() || !prompt.trim()) {
    return { status: 400, error: RequestError.fields };
  }
  return { system, prompt };
}

export function buildUpstreamBody(input: AnswerInput, env: Env) {
  return {
    model: env.MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    stream: true,
    system: [
      { type: "text", text: input.system, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: input.prompt }],
    // Recent models always decide for themselves how much to think; effort sets how much.
    thinking: { type: "adaptive" },
    output_config: { effort: env.EFFORT },
  };
}

function errorResponse(status: number, error: string, headers = {}) {
  return Response.json(
    { error },
    { status, headers: { "cache-control": NO_STORE, ...headers } },
  );
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (new URL(request.url).pathname !== ANSWER_PATH) {
    return errorResponse(404, RequestError.notFound);
  }
  if (request.method !== "POST") {
    return errorResponse(405, RequestError.method, { allow: "POST" });
  }

  try {
    const key = request.headers.get("CF-Connecting-IP") || UNKNOWN_CLIENT;
    const { success } = await env.LIMITER.limit({ key });
    if (!success) return errorResponse(429, RequestError.rateLimited);
  } catch {
    return errorResponse(503, RequestError.limiterDown);
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return errorResponse(400, RequestError.invalidJson);
  }
  const input = validateInput(value);
  if ("error" in input) return errorResponse(input.status, input.error);
  if (!env.ANTHROPIC_API_KEY) return errorResponse(500, RequestError.missingKey);

  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": ContentType.json,
      },
      body: JSON.stringify(buildUpstreamBody(input, env)),
      signal: request.signal,
    });
  } catch {
    return errorResponse(502, RequestError.upstreamDown);
  }
  if (!upstream.ok) {
    void upstream.body?.cancel().catch(() => {});
    return errorResponse(502, `upstream ${upstream.status}`);
  }
  if (!upstream.body) return errorResponse(502, RequestError.noUpstreamStream);

  return new Response(sseToNdjson(upstream.body), {
    status: 200,
    headers: {
      "content-type": ContentType.ndjson,
      "cache-control": NO_STORE,
    },
  });
}

export default { fetch: handleRequest } satisfies ExportedHandler<Env>;
