import type { Env } from "./index.ts";
import {
  ANTHROPIC_URL, ANTHROPIC_VERSION, ContentType, Header, NO_STORE, RequestError, errorResponse,
} from "./http.ts";
import {
  anthropicToOpenAiStream, openAiChunk, OPENAI_DONE, type ChatStreamMetadata,
} from "./chatStream.ts";

export const MAX_CHAT_BODY_CHARS = 200000;
export const VOICE_MAX_TOKENS = 600;
export const NARRATE_PREFIX = "[narrate] ";
export const NARRATION_CHUNK_CHARS = 120;
const BEARER_PREFIX = "Bearer ";
const HASH_ALGORITHM = "SHA-256";
const HASH_BYTES = 32;
const MILLISECONDS_PER_SECOND = 1000;
const COMPLETION_ID_PREFIX = "chatcmpl-";
const CONVERSATION_START = "(The conversation starts.)";
const ChatError = {
  tooLarge: "request too large",
  messages: "messages must be a non-empty array of chat messages",
  stream: "stream must be true",
  options: "invalid chat options",
  unauthorized: "unauthorized",
} as const;
const Role = { system: "system", user: "user", assistant: "assistant", tool: "tool" } as const;
type TextContent = string | readonly { type: "text"; text: string }[];
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments?: string };
}
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: TextContent | null;
  tool_calls?: readonly ToolCall[];
  tool_call_id?: string;
}
interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}
type ToolChoice = "auto" | "required" | "none" | { type: "function"; function: { name: string } };
export interface ChatRequest {
  messages: readonly ChatMessage[];
  stream: true;
  tools?: readonly ChatTool[];
  tool_choice?: ToolChoice;
  max_tokens?: number;
  temperature?: number;
  model?: string;
  user_id?: string;
  elevenlabs_extra_body?: unknown;
  stream_options?: unknown;
}
type ValidationError = { status: 400 | 413; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is TextContent {
  return typeof value === "string" || (Array.isArray(value) && value.every(
    (block) => isObject(block) && block.type === "text" && typeof block.text === "string",
  ));
}

function isFunction(value: unknown): value is Record<string, unknown> & { name: string } {
  return isObject(value) && typeof value.name === "string" && value.name.length > 0;
}

function isMessage(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.role === Role.assistant) {
    if (value.content != null && !isText(value.content)) return false;
    return value.tool_calls === undefined || (Array.isArray(value.tool_calls) && value.tool_calls.every(
      (call) => isObject(call) && call.type === "function" && typeof call.id === "string" &&
        isFunction(call.function) &&
        (call.function.arguments === undefined || typeof call.function.arguments === "string"),
    ));
  }
  if (value.role === Role.tool) return typeof value.tool_call_id === "string" && isText(value.content);
  return (value.role === Role.system || value.role === Role.user) && isText(value.content);
}

export function validateChatInput(value: unknown): ChatRequest | ValidationError {
  if (!isObject(value)) return { status: 400, error: RequestError.notObject };
  if (JSON.stringify(value).length > MAX_CHAT_BODY_CHARS) return { status: 413, error: ChatError.tooLarge };
  if (!Array.isArray(value.messages) || !value.messages.length || !value.messages.every(isMessage)) {
    return { status: 400, error: ChatError.messages };
  }
  if (value.stream !== true) return { status: 400, error: ChatError.stream };
  const choice = value.tool_choice;
  if (
    (value.max_tokens !== undefined && (
      typeof value.max_tokens !== "number" || !Number.isInteger(value.max_tokens) || value.max_tokens <= 0
    )) ||
    (value.temperature !== undefined && (
      typeof value.temperature !== "number" || !Number.isFinite(value.temperature)
    )) ||
    (value.tools !== undefined && (!Array.isArray(value.tools) || !value.tools.every((tool) =>
      isObject(tool) && tool.type === "function" && isFunction(tool.function) &&
      (tool.function.description === undefined || typeof tool.function.description === "string") &&
      (tool.function.parameters === undefined || isObject(tool.function.parameters))))) ||
    (choice !== undefined && choice !== "auto" && choice !== "required" && choice !== "none" &&
      !(isObject(choice) && choice.type === "function" && isFunction(choice.function)))
  ) return { status: 400, error: ChatError.options };
  return {
    stream: true,
    messages: value.messages as unknown as ChatRequest["messages"],
    ...(value.tools !== undefined ? { tools: value.tools as unknown as ChatRequest["tools"] } : {}),
    ...(choice !== undefined ? { tool_choice: choice as ToolChoice } : {}),
    ...(typeof value.max_tokens === "number" ? { max_tokens: value.max_tokens } : {}),
    ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
  };
}

export function chatText(content: TextContent | null | undefined): string {
  if (typeof content === "string") return content;
  return content?.map((block) => block.text).join("") ?? "";
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };
type Message = { role: "user" | "assistant"; content: ContentBlock[] };

function toolInput(argumentsText: string | undefined): unknown {
  try { return JSON.parse(argumentsText || "{}"); } catch { return {}; }
}

function toolChoice(choice: ToolChoice | undefined) {
  if (choice === undefined) return undefined;
  if (typeof choice === "object") return { type: "tool", name: choice.function.name };
  return { type: choice === "required" ? "any" : choice };
}

export function buildChatUpstreamBody(request: ChatRequest, env: Pick<Env, "VOICE_MODEL">) {
  const system: string[] = [];
  const messages: Message[] = [];
  for (const message of request.messages) {
    const text = chatText(message.content);
    if (message.role === Role.system) { system.push(text); continue; }
    const role = message.role === Role.assistant ? Role.assistant : Role.user;
    const content: ContentBlock[] = message.role === Role.tool
      ? [{ type: "tool_result", tool_use_id: message.tool_call_id!, content: text }]
      : text ? [{ type: "text", text }] : [];
    for (const call of message.role === Role.assistant ? message.tool_calls ?? [] : []) {
      content.push({ type: "tool_use", id: call.id, name: call.function.name, input: toolInput(call.function.arguments) });
    }
    if (messages.at(-1)?.role === role) messages.at(-1)!.content.push(...content);
    else messages.push({ role, content });
  }
  if (!messages.length || messages[0].role === Role.assistant) {
    messages.unshift({ role: Role.user, content: [{ type: "text", text: CONVERSATION_START }] });
  }
  return {
    model: env.VOICE_MODEL,
    max_tokens: Math.min(request.max_tokens ?? VOICE_MAX_TOKENS, VOICE_MAX_TOKENS),
    stream: true,
    ...(system.length ? { system: [{ type: "text", text: system.join("\n"), cache_control: { type: "ephemeral" } }] } : {}),
    messages,
    ...(request.tools ? { tools: request.tools.map(({ function: tool }) => ({
      name: tool.name,
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      input_schema: tool.parameters ?? { type: "object", properties: {} },
    })) } : {}),
    ...(request.tool_choice !== undefined ? { tool_choice: toolChoice(request.tool_choice) } : {}),
    ...(typeof request.temperature === "number" ? { temperature: request.temperature } : {}),
  };
}

async function authorized(request: Request, secret: string): Promise<boolean> {
  const header = request.headers.get(Header.authorization) ?? "";
  const bearer = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : "";
  const encoder = new TextEncoder();
  // Hash both UTF-8 values so comparison has fixed cost even when their lengths differ.
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest(HASH_ALGORITHM, encoder.encode(bearer)),
    crypto.subtle.digest(HASH_ALGORITHM, encoder.encode(secret)),
  ]);
  const actualBytes = new Uint8Array(actual);
  const expectedBytes = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < HASH_BYTES; index++) difference |= actualBytes[index] ^ expectedBytes[index];
  return difference === 0 && secret.length > 0 && header.startsWith(BEARER_PREFIX);
}

function narrationStream(text: string, metadata: ChatStreamMetadata): ReadableStream<Uint8Array> {
  function* chunks() {
    yield openAiChunk(metadata, { role: "assistant", content: "" });
    let remaining = text;
    while (remaining.length) {
      let boundary = Math.min(remaining.length, NARRATION_CHUNK_CHARS);
      if (remaining.length > NARRATION_CHUNK_CHARS) {
        const space = remaining.lastIndexOf(" ", NARRATION_CHUNK_CHARS - 1);
        if (space >= 0) boundary = space + 1;
      }
      yield openAiChunk(metadata, { content: remaining.slice(0, boundary) });
      remaining = remaining.slice(boundary);
    }
    yield openAiChunk(metadata, {}, "stop");
    yield OPENAI_DONE;
  }
  const iterator = chunks();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = iterator.next();
      if (chunk.done) controller.close();
      else controller.enqueue(encoder.encode(chunk.value));
    },
    cancel() { iterator.return(); },
  });
}

export async function handleChatCompletion(request: Request, env: Env): Promise<Response> {
  if (!await authorized(request, env.AGENT_LLM_SECRET ?? "")) return errorResponse(401, ChatError.unauthorized);
  let value: unknown;
  try {
    const body = await request.text();
    if (body.length > MAX_CHAT_BODY_CHARS) return errorResponse(413, ChatError.tooLarge);
    value = JSON.parse(body);
  } catch {
    return errorResponse(400, RequestError.invalidJson);
  }
  const input = validateChatInput(value);
  if ("error" in input) return errorResponse(input.status, input.error);
  const metadata = {
    id: COMPLETION_ID_PREFIX + crypto.randomUUID(), model: env.VOICE_MODEL,
    created: Math.floor(Date.now() / MILLISECONDS_PER_SECOND),
  };
  const headers = { [Header.contentType]: ContentType.sse, [Header.cacheControl]: NO_STORE };
  const lastMessage = input.messages.filter((message) => message.role !== Role.system).at(-1);
  const text = chatText(lastMessage?.content);
  if (lastMessage?.role === Role.user && text.startsWith(NARRATE_PREFIX)) {
    return new Response(narrationStream(text.slice(NARRATE_PREFIX.length), metadata), { headers });
  }
  if (!env.ANTHROPIC_API_KEY) return errorResponse(500, RequestError.missingKey);
  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        [Header.anthropicKey]: env.ANTHROPIC_API_KEY,
        [Header.anthropicVersion]: ANTHROPIC_VERSION,
        [Header.contentType]: ContentType.json,
      },
      body: JSON.stringify(buildChatUpstreamBody(input, env)),
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
  return new Response(anthropicToOpenAiStream(upstream.body, metadata), { headers });
}
