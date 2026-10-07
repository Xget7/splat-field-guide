import type { Env } from "./index.ts";
import { ContentType, Header, NO_STORE, RequestError, errorResponse, requestAnthropic } from "./http.ts";
import { authorized } from "./auth.ts";
import { anthropicToOpenAiStream, openAiStreamError } from "./chatStream.ts";
import { NARRATE_PREFIX, narrationStream } from "./narration.ts";
import { CACHE_CONTROL_TYPE, FUNCTION_TYPE, Role, ToolChoiceType } from "./protocol.ts";

export const MAX_CHAT_BODY_CHARS = 200000;
export const VOICE_MAX_TOKENS = 600;
export const VOICE_EFFORT = "medium";
// ElevenLabs replays history in the OpenAI format, which cannot carry thinking blocks, and a voice needs its first word fast.
export const VOICE_THINKING = { type: "disabled" } as const;
const ANTHROPIC_CONNECTION_TIMEOUT_MS = 10000;
const MILLISECONDS_PER_SECOND = 1000;
const COMPLETION_ID_PREFIX = "chatcmpl-";
const CONVERSATION_START = "(The conversation starts.)";
// The voice model rejects a conversation that ends on its own turn.
const CONVERSATION_CONTINUE = "(Continue.)";
const ChatError = {
  tooLarge: "request too large",
  messages: "messages must be a non-empty array of chat messages",
  stream: "stream must be true",
  options: "invalid chat options",
  unauthorized: "unauthorized",
} as const;
type TextBlock = { type: "text"; text: string };
type TextContent = string | readonly TextBlock[];
interface ToolCall {
  id: string;
  type: typeof FUNCTION_TYPE;
  function: { name: string; arguments?: string };
}
interface ChatMessage {
  role: typeof Role[keyof typeof Role];
  content?: TextContent | null;
  tool_calls?: readonly ToolCall[];
  tool_call_id?: string;
}
interface ChatTool {
  type: typeof FUNCTION_TYPE;
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}
type ToolChoice =
  | typeof ToolChoiceType.auto | typeof ToolChoiceType.required | typeof ToolChoiceType.none
  | { type: typeof FUNCTION_TYPE; function: { name: string } };
export interface ChatRequest {
  messages: readonly ChatMessage[];
  stream: true;
  tools?: readonly ChatTool[] | null;
  tool_choice?: ToolChoice | null;
  max_tokens?: unknown;
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

function isNamedFunction(value: unknown): value is Record<string, unknown> & { name: string } {
  return isObject(value) && typeof value.name === "string" && value.name.length > 0;
}

function isToolCall(value: unknown): value is ToolCall {
  return isObject(value) && value.type === FUNCTION_TYPE && typeof value.id === "string" &&
    isNamedFunction(value.function) &&
    (value.function.arguments === undefined || typeof value.function.arguments === "string");
}

function isMessage(value: unknown): value is ChatMessage {
  if (!isObject(value)) return false;
  if (value.role === Role.assistant) {
    return (value.content == null || isText(value.content)) &&
      (value.tool_calls === undefined || (Array.isArray(value.tool_calls) && value.tool_calls.every(isToolCall)));
  }
  if (value.role === Role.tool) return typeof value.tool_call_id === "string" && isText(value.content);
  return (value.role === Role.system || value.role === Role.user) && isText(value.content);
}

function isChatTool(value: unknown): value is ChatTool {
  return isObject(value) && value.type === FUNCTION_TYPE && isNamedFunction(value.function) &&
    (value.function.description === undefined || typeof value.function.description === "string") &&
    (value.function.parameters === undefined || isObject(value.function.parameters));
}

function isChatTools(value: unknown): value is readonly ChatTool[] {
  return Array.isArray(value) && value.every(isChatTool);
}

function isToolChoice(value: unknown): value is ToolChoice {
  return value === ToolChoiceType.auto || value === ToolChoiceType.required || value === ToolChoiceType.none ||
    (isObject(value) && value.type === FUNCTION_TYPE && isNamedFunction(value.function));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function validateChatInput(value: unknown): ChatRequest | ValidationError {
  if (!isObject(value)) return { status: 400, error: RequestError.notObject };
  if (JSON.stringify(value).length > MAX_CHAT_BODY_CHARS) return { status: 413, error: ChatError.tooLarge };
  if (!Array.isArray(value.messages) || !value.messages.length || !value.messages.every(isMessage)) {
    return { status: 400, error: ChatError.messages };
  }
  if (value.stream !== true) return { status: 400, error: ChatError.stream };
  const tools = value.tools;
  if (tools != null && !isChatTools(tools)) {
    return { status: 400, error: ChatError.options };
  }
  const choice = value.tool_choice;
  if (choice != null && !isToolChoice(choice)) return { status: 400, error: ChatError.options };
  return {
    stream: true,
    messages: value.messages,
    ...(tools != null ? { tools } : {}),
    ...(choice != null ? { tool_choice: choice } : {}),
    ...(isPositiveInteger(value.max_tokens) ? { max_tokens: value.max_tokens } : {}),
  };
}

function chatText(content: TextContent | null | undefined): string {
  if (typeof content === "string") return content;
  return content?.map((block) => block.text).join("") ?? "";
}

function textBlocks(content: TextContent | null | undefined): TextBlock[] {
  const blocks = typeof content === "string" ? [{ type: "text" as const, text: content }] : content ?? [];
  return blocks.filter((block) => block.text.trim().length > 0);
}

type ContentBlock =
  | TextBlock
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };
type Message = { role: typeof Role.user | typeof Role.assistant; content: ContentBlock[] };

function toolInput(argumentsText: string | undefined): unknown {
  try { return JSON.parse(argumentsText || "{}"); } catch { return {}; }
}

function toolChoice(choice: ToolChoice) {
  if (typeof choice === "object") return { type: ToolChoiceType.tool, name: choice.function.name };
  return { type: choice === ToolChoiceType.required ? ToolChoiceType.any : choice };
}

export function buildChatUpstreamBody(request: ChatRequest, env: Pick<Env, "VOICE_MODEL">) {
  const system: string[] = [];
  const messages: Message[] = [];
  for (const message of request.messages) {
    const text = textBlocks(message.content);
    if (message.role === Role.system) {
      system.push(...text.map((block) => block.text));
      continue;
    }
    const role = message.role === Role.assistant ? Role.assistant : Role.user;
    const content: ContentBlock[] = message.role === Role.tool
      ? [{ type: "tool_result", tool_use_id: message.tool_call_id!, content: text.map((block) => block.text).join("") }]
      : [...text];
    for (const call of message.role === Role.assistant ? message.tool_calls ?? [] : []) {
      content.push({ type: "tool_use", id: call.id, name: call.function.name, input: toolInput(call.function.arguments) });
    }
    if (!content.length) continue;
    const previous = messages.at(-1);
    if (previous?.role === role) previous.content.push(...content);
    else messages.push({ role, content });
  }
  for (const message of messages) {
    if (message.role === Role.user) {
      message.content = [
        ...message.content.filter((block) => block.type === "tool_result"),
        ...message.content.filter((block) => block.type !== "tool_result"),
      ];
    }
  }
  if (!messages.length || messages[0].role === Role.assistant) {
    messages.unshift({ role: Role.user, content: [{ type: "text", text: CONVERSATION_START }] });
  }
  if (messages.at(-1)?.role === Role.assistant) {
    messages.push({ role: Role.user, content: [{ type: "text", text: CONVERSATION_CONTINUE }] });
  }
  return {
    model: env.VOICE_MODEL,
    max_tokens: Math.min(isPositiveInteger(request.max_tokens) ? request.max_tokens : VOICE_MAX_TOKENS, VOICE_MAX_TOKENS),
    stream: true,
    ...(system.length ? { system: [{ type: "text", text: system.join("\n"), cache_control: { type: CACHE_CONTROL_TYPE } }] } : {}),
    messages,
    ...(request.tools != null ? { tools: request.tools.map(({ function: tool }) => ({
      name: tool.name,
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      input_schema: tool.parameters ?? { type: "object", properties: {} },
    })) } : {}),
    ...(request.tool_choice != null ? { tool_choice: toolChoice(request.tool_choice) } : {}),
    thinking: VOICE_THINKING,
    output_config: { effort: VOICE_EFFORT },
  };
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
  const upstream = await requestAnthropic(request, env, buildChatUpstreamBody(input, env), ANTHROPIC_CONNECTION_TIMEOUT_MS);
  if ("error" in upstream) {
    return upstream.timedOut ? new Response(openAiStreamError(), { headers }) : upstream.error;
  }
  return new Response(anthropicToOpenAiStream(upstream.body, metadata), { headers });
}
