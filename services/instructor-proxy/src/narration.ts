import { openAiChunk, OPENAI_DONE, type ChatStreamMetadata } from "./chatStream.ts";
import { FinishReason, Role } from "./protocol.ts";

export const NARRATE_PREFIX = "[narrate] ";
export const NARRATION_CHUNK_CHARS = 120;

export function narrationStream(text: string, metadata: ChatStreamMetadata): ReadableStream<Uint8Array> {
  function* chunks() {
    yield openAiChunk(metadata, { role: Role.assistant, content: "" });
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
    yield openAiChunk(metadata, {}, FinishReason.stop);
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

