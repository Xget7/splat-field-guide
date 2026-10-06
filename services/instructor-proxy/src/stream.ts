const SseEvent = {
  messageStop: "message_stop",
  messageDelta: "message_delta",
  blockStart: "content_block_start",
  blockDelta: "content_block_delta",
  error: "error",
} as const;
const TEXT_DELTA = "text_delta";
const COMPLETE_STOP_REASONS = new Set(["end_turn", "stop_sequence"]);

const SseField = { event: "event", data: "data" } as const;

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
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let eventName = "";
  let data: string[] = [];
  // Retain diagnostics to distinguish empty answers from refusals or exhausted thinking budgets.
  let stopReason: string | undefined;
  const blocks = new Set<string>();
  const events = new Set<string>();
  let wroteText = false;
  let ended = false;
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

  function parseLine(line: string): OutputLine | undefined {
    if (line === "") {
      const name = eventName;
      const payload = data.join("\n");
      const hasData = data.length > 0;
      eventName = "";
      data = [];
      if (!hasData) return;
      events.add(name);
      switch (name) {
        case SseEvent.messageStop:
          return doneLine();
        case SseEvent.error:
          return { error: StreamError.upstream };
        case SseEvent.messageDelta:
        case SseEvent.blockStart:
          return readDiagnostics(payload);
        case SseEvent.blockDelta:
          return readDelta(payload);
        default:
          return;
      }
    }

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === SseField.event) eventName = value;
    if (field === SseField.data) data.push(value);
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
          const boundary = buffer.search(/[\r\n]/);
          // A trailing CR may be the first half of a CRLF split across chunks.
          if (
            boundary >= 0 &&
            !(buffer[boundary] === "\r" && boundary === buffer.length - 1 && !ended)
          ) {
            const line = buffer.slice(0, boundary);
            const width = buffer[boundary] === "\r" && buffer[boundary + 1] === "\n" ? 2 : 1;
            buffer = buffer.slice(boundary + width);
            const output = parseLine(line);
            if (output) {
              emit(controller, output);
              return;
            }
            continue;
          }
          if (ended) {
            emit(controller, { error: StreamError.noStop });
            return;
          }

          const chunk = await reader.read();
          if (finished) return;
          ended = chunk.done;
          buffer += ended ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
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
