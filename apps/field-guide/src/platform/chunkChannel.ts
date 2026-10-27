/** Text pieces a transport pushes as they arrive and one reader pulls in order. */
export interface ChunkChannel {
  readonly chunks: AsyncIterable<string>;
  push(chunk: string): void;
  /** Ends the reader's iteration once the buffered chunks are read. */
  end(): void;
  /** Rejects the reader's iteration once the buffered chunks are read. */
  fail(error: unknown): void;
}

type Closing =
  | { readonly failed: false }
  | { readonly failed: true; readonly error: unknown };

interface Waiting {
  resolve(result: IteratorResult<string>): void;
  reject(error: unknown): void;
}

const ENDED: IteratorResult<string> = { done: true, value: undefined };

/**
 * Turns pushed chunks into an async iterable, so a transport can deliver text before anyone reads it
 * and the reader still sees every chunk once, in order, before the end or the failure.
 */
export function createChunkChannel(): ChunkChannel {
  const buffered: string[] = [];
  let closing: Closing | null = null;
  let waiting: Waiting | null = null;

  // Hands the reader that is waiting the next chunk, or the close once nothing is buffered.
  const settleWaiting = () => {
    const reader = waiting;
    if (reader === null) {
      return;
    }
    if (buffered.length > 0) {
      waiting = null;
      reader.resolve({ done: false, value: buffered.shift()! });
    } else if (closing !== null) {
      waiting = null;
      if (closing.failed) {
        reader.reject(closing.error);
      } else {
        reader.resolve(ENDED);
      }
    }
  };
  const close = (how: Closing) => {
    if (closing === null) {
      closing = how;
      settleWaiting();
    }
  };
  const iterator: AsyncIterator<string> = {
    next: () =>
      new Promise((resolve, reject) => {
        waiting = { resolve, reject };
        settleWaiting();
      }),
  };
  return {
    chunks: { [Symbol.asyncIterator]: () => iterator },
    push(chunk) {
      if (closing === null) {
        buffered.push(chunk);
        settleWaiting();
      }
    },
    end: () => close({ failed: false }),
    fail: error => close({ failed: true, error }),
  };
}
