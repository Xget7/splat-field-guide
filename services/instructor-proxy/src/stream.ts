import { StopReason } from "./protocol.ts";
import { createSseReader, type SseMessage } from "./sse.ts";

const SseEvent = {
  messageStop: "message_stop",
  messageDelta: "message_delta",
  blockStart: "content_block_start",
  blockDelta: "content_block_delta",
  error: "error",
} as const;
const TEXT_DELTA = "text_delta";
const COMPLETE_STOP_REASONS = new Set<string>([StopReason.endTurn, StopReason.stopSequence]);

export const StreamError = {
  upstream: "upstream error",
  invalidEvent: "invalid upstream event",
  noStop: "upstream ended without message_stop",
  readFailed: "upstream read failed",
  incomplete: "upstream answer incomplete",
} as const;

type OutputLine =
  | { text: string }
  | { done: true; stop?: string; blocks?: string[]; events?: string[] }
  | { error: string };

export function sseToNdjson(
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = createSseReader(source);
  const encoder = new TextEncoder();
  // Retain diagnostics to distinguish empty answers from refusals or exhausted thinking budgets.
  let stopReason: string | undefined;
  const blocks = new Set<string>();
  const events = new Set<string>();
  let wroteText = false;
  let finished = false;

  function doneLine(): OutputLine {
    if (!stopReason || !COMPLETE_STOP_REASONS.has(stopReason)) {
      return { error: StreamError.incomplete };
    }
    return {
      done: true,
      ...(stopReason ? { stop: stopReason } : {}),
      ...(blocks.size > 0 ? { blocks: [...blocks] } : {}),
      ...(wroteText ? {} : { events: [...events] }),
    };
  }

  function readDiagnostics(payload: string): OutputLine | undefined {
    try {
      const event = JSON.parse(payload) as {
        delta?: { stop_reason?: unknown };
        content_block?: { type?: unknown };
      } | null;
      if (typeof event?.delta?.stop_reason === "string") stopReason = event.delta.stop_reason;
      if (typeof event?.content_block?.type === "string") blocks.add(event.content_block.type);
    } catch {
      return { error: StreamError.invalidEvent };
    }
  }

  function readDelta(payload: string): OutputLine | undefined {
    try {
      const event = JSON.parse(payload) as {
        delta?: { type?: unknown; text?: unknown };
      } | null;
      if (event?.delta?.type !== TEXT_DELTA) return;
      if (typeof event.delta.text !== "string") return { error: StreamError.invalidEvent };
      wroteText ||= event.delta.text.length > 0;
      return { text: event.delta.text };
    } catch {
      return { error: StreamError.invalidEvent };
    }
  }

  function parseEvent({ name, data }: SseMessage): OutputLine | undefined {
    events.add(name);
    switch (name) {
      case SseEvent.messageStop:
        return doneLine();
      case SseEvent.error:
        return { error: StreamError.upstream };
      case SseEvent.messageDelta:
      case SseEvent.blockStart:
        return readDiagnostics(data);
      case SseEvent.blockDelta:
        return readDelta(data);
      default:
        return;
    }
  }

  function emit(
    controller: ReadableStreamDefaultController<Uint8Array>,
    line: OutputLine,
  ) {
    controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
    if (!("text" in line)) {
      finished = true;
      controller.close();
      // Cancel upstream to release resources after a terminal event.
      void reader.cancel().catch(() => {});
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!finished) {
          const event = await reader.next();
          if (finished) return;
          if (!event) {
            emit(controller, { error: StreamError.noStop });
            return;
          }
          const output = parseEvent(event);
          if (output) {
            emit(controller, output);
            return;
          }
        }
      } catch {
        if (!finished) emit(controller, { error: StreamError.readFailed });
      }
    },
    cancel(reason) {
      finished = true;
      return reader.cancel(reason);
    },
  });
}
