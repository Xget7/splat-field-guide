/** What one complete line of the answer stream says. */
export const ProxyEventType = {
  text: 'text',
  done: 'done',
  failure: 'failure',
} as const;

/** Why a line could not continue the stream. */
export const StreamFailureKind = {
  unreadable: 'unreadable',
  badEvent: 'badEvent',
  remoteError: 'remoteError',
} as const;
export type StreamFailureKind =
  (typeof StreamFailureKind)[keyof typeof StreamFailureKind];

export const StreamFailureMessage = {
  unreadable: 'unreadable stream',
  badEvent: 'bad event',
} as const;

export type ProxyEvent =
  | { readonly type: typeof ProxyEventType.text; readonly text: string }
  | { readonly type: typeof ProxyEventType.done }
  | {
      readonly type: typeof ProxyEventType.failure;
      readonly kind: StreamFailureKind;
      readonly message: string;
    };

const LINE_END = '\n';

function badEvent(): ProxyEvent {
  return {
    type: ProxyEventType.failure,
    kind: StreamFailureKind.badEvent,
    message: StreamFailureMessage.badEvent,
  };
}

function eventFor(line: string): ProxyEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return {
      type: ProxyEventType.failure,
      kind: StreamFailureKind.unreadable,
      message: StreamFailureMessage.unreadable,
    };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return badEvent();
  }
  const fields = value as Record<string, unknown>;
  // An error wins over text or done on the same line, because the reply it belongs to is cut off.
  if (fields.error !== undefined) {
    return typeof fields.error === 'string'
      ? {
          type: ProxyEventType.failure,
          kind: StreamFailureKind.remoteError,
          message: fields.error,
        }
      : badEvent();
  }
  if (typeof fields.text === 'string') {
    return { type: ProxyEventType.text, text: fields.text };
  }
  return fields.done === true ? { type: ProxyEventType.done } : badEvent();
}

/**
 * Reads the answer stream as it arrives: each feed returns the events of the lines it completed,
 * and keeps an unfinished last line for the next feed.
 */
export function createNdjsonEvents() {
  let pending = '';
  return {
    feed(chunk: string): readonly ProxyEvent[] {
      const lines = (pending + chunk).split(LINE_END);
      pending = lines.pop() ?? '';
      return lines
        .map(line => line.trim())
        .filter(line => line !== '')
        .map(eventFor);
    },
  };
}
