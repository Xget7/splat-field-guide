const SseField = { event: "event", data: "data" } as const;
const INVALID_SSE_EVENT = "invalid SSE event";
const SSE_INACTIVITY_TIMEOUT = "upstream stream inactive";
export interface SseMessage { name: string; data: string }

export function createSseReader(source: ReadableStream<Uint8Array>, inactivityTimeoutMs?: number) {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let data: string[] = [];
  let ended = false;
  let cancelled = false;

  async function read() {
    if (inactivityTimeoutMs === undefined) return reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(SSE_INACTIVITY_TIMEOUT)), inactivityTimeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return {
    async next(): Promise<SseMessage | undefined> {
      while (!cancelled) {
        const boundary = buffer.search(/[\r\n]/);
        // Wait for a trailing CR in case the next chunk starts with LF.
        if (boundary >= 0 && !(buffer[boundary] === "\r" && boundary === buffer.length - 1 && !ended)) {
          const line = buffer.slice(0, boundary);
          const width = buffer[boundary] === "\r" && buffer[boundary + 1] === "\n" ? 2 : 1;
          buffer = buffer.slice(boundary + width);
          if (line === "") {
            if (eventName && !data.length) throw new Error(INVALID_SSE_EVENT);
            const event = data.length ? { name: eventName, data: data.join("\n") } : undefined;
            eventName = "";
            data = [];
            if (event) return event;
            continue;
          }
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          let value = colon < 0 ? "" : line.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === SseField.event) eventName = value;
          if (field === SseField.data) data.push(value);
          continue;
        }
        if (ended) return;
        const chunk = await read();
        if (cancelled) return;
        ended = chunk.done;
        buffer += ended ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      }
    },
    cancel(reason?: unknown) {
      cancelled = true;
      return reader.cancel(reason);
    },
  };
}
