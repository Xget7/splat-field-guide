import {
  FinishReason, FUNCTION_TYPE, Role, StopReason, type AnthropicStopReason, type OpenAiFinishReason,
} from "./protocol.ts";
import { createSseReader } from "./sse.ts";

const EventName = {
  start: "message_start", blockStart: "content_block_start", blockDelta: "content_block_delta",
  blockStop: "content_block_stop", delta: "message_delta", stop: "message_stop", error: "error",
} as const;
const DeltaType = { text: "text_delta", json: "input_json_delta" } as const;
const finishReasons = {
  [StopReason.endTurn]: FinishReason.stop,
  [StopReason.stopSequence]: FinishReason.stop,
  [StopReason.toolUse]: FinishReason.toolCalls,
  [StopReason.maxTokens]: FinishReason.length,
  [StopReason.refusal]: FinishReason.contentFilter,
} as const satisfies Record<AnthropicStopReason, OpenAiFinishReason>;
const CHUNK_OBJECT = "chat.completion.chunk";
const ANTHROPIC_STREAM_INACTIVITY_TIMEOUT_MS = 15000;
export const OPENAI_DONE = "data: [DONE]\n\n";
const UPSTREAM_ERROR_MESSAGE = "upstream stream failed";
const UPSTREAM_ERROR_TYPE = "upstream_error";
export function openAiStreamError() {
  return `data: ${JSON.stringify({ error: { message: UPSTREAM_ERROR_MESSAGE, type: UPSTREAM_ERROR_TYPE } })}\n\n`;
}
export interface ChatStreamMetadata { id: string; model: string; created: number }

export function openAiChunk(metadata: ChatStreamMetadata, delta: object, finishReason: OpenAiFinishReason | null = null) {
  return `data: ${JSON.stringify({
    ...metadata, object: CHUNK_OBJECT,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

interface AnthropicEvent {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
}

export function anthropicToOpenAiStream(source: ReadableStream<Uint8Array>, metadata: ChatStreamMetadata) {
  const reader = createSseReader(source, ANTHROPIC_STREAM_INACTIVITY_TIMEOUT_MS);
  const encoder = new TextEncoder();
  const toolIndices = new Map<number, { index: number; hasArguments: boolean }>();
  let finished = false;

  function close(controller: ReadableStreamDefaultController<Uint8Array>) {
    finished = true;
    controller.close();
    void reader.cancel().catch(() => {});
  }

  function fail(controller: ReadableStreamDefaultController<Uint8Array>) {
    controller.enqueue(encoder.encode(openAiStreamError()));
    close(controller);
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!finished) {
          const event = await reader.next();
          if (finished) return;
          if (!event || event.name === EventName.error) { fail(controller); return; }
          const payload = JSON.parse(event.data) as AnthropicEvent;
          if (!event.name || !payload || typeof payload !== "object" || Array.isArray(payload) ||
            (payload.type !== undefined && payload.type !== event.name)) { fail(controller); return; }
          let delta: object | undefined;
          let finishReason: OpenAiFinishReason | null = null;
          switch (event.name) {
            case EventName.start:
              delta = { role: Role.assistant, content: "" };
              break;
            case EventName.blockStart:
              if (typeof payload.content_block?.type !== "string") { fail(controller); return; }
              if (payload.content_block?.type === "tool_use") {
                const block = payload.content_block;
                if (!Number.isInteger(payload.index) || typeof block.id !== "string" || typeof block.name !== "string") {
                  fail(controller); return;
                }
                const index = toolIndices.size;
                toolIndices.set(payload.index!, { index, hasArguments: false });
                delta = { tool_calls: [{ index, id: block.id, type: FUNCTION_TYPE, function: { name: block.name, arguments: "" } }] };
              }
              break;
            case EventName.blockDelta:
              if (typeof payload.delta?.type !== "string") { fail(controller); return; }
              if (payload.delta?.type === DeltaType.text) {
                if (typeof payload.delta.text !== "string") { fail(controller); return; }
                delta = { content: payload.delta.text };
              } else if (payload.delta?.type === DeltaType.json) {
                const tool = toolIndices.get(payload.index!);
                if (!tool || typeof payload.delta.partial_json !== "string") { fail(controller); return; }
                tool.hasArguments ||= payload.delta.partial_json.length > 0;
                delta = { tool_calls: [{ index: tool.index, function: { arguments: payload.delta.partial_json } }] };
              }
              break;
            case EventName.blockStop: {
              if (!Number.isInteger(payload.index)) { fail(controller); return; }
              const tool = toolIndices.get(payload.index!);
              if (tool && !tool.hasArguments) {
                tool.hasArguments = true;
                delta = { tool_calls: [{ index: tool.index, function: { arguments: "{}" } }] };
              }
              break;
            }
            case EventName.delta:
              if (!payload.delta || typeof payload.delta !== "object" || Array.isArray(payload.delta)) {
                fail(controller); return;
              }
              if (payload.delta.stop_reason != null && typeof payload.delta.stop_reason !== "string") {
                fail(controller); return;
              }
              if (typeof payload.delta?.stop_reason === "string") {
                finishReason = Object.hasOwn(finishReasons, payload.delta.stop_reason)
                  ? finishReasons[payload.delta.stop_reason as AnthropicStopReason] : FinishReason.stop;
                delta = {};
              }
              break;
            case EventName.stop:
              controller.enqueue(encoder.encode(OPENAI_DONE));
              close(controller);
              return;
          }
          if (delta) {
            controller.enqueue(encoder.encode(openAiChunk(metadata, delta, finishReason)));
            return;
          }
        }
      } catch {
        if (!finished) fail(controller);
      }
    },
    cancel(reason) {
      finished = true;
      return reader.cancel(reason);
    },
  });
}
