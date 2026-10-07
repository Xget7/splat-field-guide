import { handleVoiceSession } from "./voice.ts";
import { handleChatCompletion } from "./chat.ts";
import {
  ContentType, Header, NO_STORE, RequestError, errorResponse, limitRequest, requestAnthropic,
} from "./http.ts";
import { CACHE_CONTROL_TYPE, Role } from "./protocol.ts";
import { sseToNdjson } from "./stream.ts";

export { RequestError } from "./http.ts";

const ANSWER_PATH = "/v1/answer";
const PING_PATH = "/v1/ping";
const VOICE_PATH = "/v1/voice/session";
const CHAT_PATH = "/v1/chat/completions";
const MAX_SYSTEM_CHARS = 60000;
const MAX_PROMPT_CHARS = 6000;
// Thinking and the answer share this ceiling; exhausting it fails the stream so the app can fall back.
const MAX_OUTPUT_TOKENS = 1500;

export interface Env {
  ANTHROPIC_API_KEY: string;
  MODEL: string;
  /** How hard the model reasons before answering: low, medium or high. */
  EFFORT: string;
  ELEVENLABS_API_KEY: string;
  AGENT_ID: string;
  AGENT_LLM_SECRET: string;
  VOICE_MODEL: string;
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
      { type: "text", text: input.system, cache_control: { type: CACHE_CONTROL_TYPE } },
    ],
    messages: [{ role: Role.user, content: input.prompt }],
    thinking: { type: "adaptive" },
    output_config: { effort: env.EFFORT },
  };
}

async function handleAnswer(request: Request, env: Env): Promise<Response> {
  const limited = await limitRequest(request, env);
  if (limited) return limited;

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return errorResponse(400, RequestError.invalidJson);
  }
  const input = validateInput(value);
  if ("error" in input) return errorResponse(input.status, input.error);
  const upstream = await requestAnthropic(request, env, buildUpstreamBody(input, env));
  if ("error" in upstream) return upstream.error;

  return new Response(sseToNdjson(upstream.body), {
    status: 200,
    headers: {
      [Header.contentType]: ContentType.ndjson,
      [Header.cacheControl]: NO_STORE,
    },
  });
}

const routes: Record<string, {
  method: string;
  handler: (request: Request, env: Env) => Response | Promise<Response>;
}> = {
  [VOICE_PATH]: { method: "POST", handler: handleVoiceSession },
  [CHAT_PATH]: { method: "POST", handler: handleChatCompletion },
  [ANSWER_PATH]: { method: "POST", handler: handleAnswer },
  [PING_PATH]: {
    method: "GET",
    handler: () => new Response(null, { status: 204, headers: { [Header.cacheControl]: NO_STORE } }),
  },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
  if (!route) return errorResponse(404, RequestError.notFound);
  if (request.method !== route.method) {
    return errorResponse(405, RequestError.method, { allow: route.method });
  }
  return route.handler(request, env);
}

export default { fetch: handleRequest } satisfies ExportedHandler<Env>;
