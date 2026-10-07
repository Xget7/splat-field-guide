import {
  FinishReason, FUNCTION_TYPE, Role, StopReason, type AnthropicStopReason, type OpenAiFinishReason,
} from "./protocol.ts";
import { createSseReader } from "./sse.ts";

const EventName = {
  start: "message_start", blockStart: "content_block_start", blockDelta: "content_block_delta",
  delta: "message_delta", stop: "message_stop", error: "error",
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
export const OPENAI_DONE = "data: [DONE]\n\n";
export interface ChatStreamMetadata { id: string; model: string; created: number }

export function openAiChunk(metadata: ChatStreamMetadata, delta: object, finishReason: OpenAiFinishReason | null = null) {
  return `data: ${JSON.stringify({
    ...metadata, object: CHUNK_OBJECT,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

interface AnthropicEvent {
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
}

export function anthropicToOpenAiStream(source: ReadableStream<Uint8Array>, metadata: ChatStreamMetadata) {
  const reader = createSseReader(source);
  const encoder = new TextEncoder();
  const toolIndices = new Map<number, number>();
  let finished = false;

  function close(controller: ReadableStreamDefaultController<Uint8Array>) {
    finished = true;
    controller.close();
    void reader.cancel().catch(() => {});
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!finished) {
          const event = await reader.next();
          if (finished) return;
          if (!event || event.name === EventName.error) { close(controller); return; }
          const payload = JSON.parse(event.data) as AnthropicEvent;
          if (!payload || typeof payload !== "object") { close(controller); return; }
          let delta: object | undefined;
          let finishReason: OpenAiFinishReason | null = null;
          switch (event.name) {
            case EventName.start:
              delta = { role: Role.assistant, content: "" };
              break;
            case EventName.blockStart:
              if (payload.content_block?.type === "tool_use") {
                const block = payload.content_block;
                if (!Number.isInteger(payload.index) || typeof block.id !== "string" || typeof block.name !== "string") {
                  close(controller); return;
                }
                const index = toolIndices.size;
                toolIndices.set(payload.index!, index);
                delta = { tool_calls: [{ index, id: block.id, type: FUNCTION_TYPE, function: { name: block.name, arguments: "" } }] };
              }
              break;
            case EventName.blockDelta:
              if (payload.delta?.type === DeltaType.text) {
                if (typeof payload.delta.text !== "string") { close(controller); return; }
                delta = { content: payload.delta.text };
              } else if (payload.delta?.type === DeltaType.json) {
                const index = toolIndices.get(payload.index!);
                if (index === undefined || typeof payload.delta.partial_json !== "string") { close(controller); return; }
                delta = { tool_calls: [{ index, function: { arguments: payload.delta.partial_json } }] };
              }
              break;
            case EventName.delta:
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
        if (!finished) close(controller);
      }
    },
    cancel(reason) {
      finished = true;
      return reader.cancel(reason);
    },
  });
}
