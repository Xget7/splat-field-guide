import { useEffect, useRef, useState } from 'react';

const CHARACTERS_PER_SECOND = 48;
const CATCH_UP_SECONDS = 0.24;
const REVEAL_STEP = 2;
const MILLISECONDS_PER_SECOND = 1000;

/** Reveals small batches within the answer alone; backlog raises the pace without restarting it. */
export function useAnswerReveal(
  text: string,
  streaming: boolean,
  reducedMotion: boolean,
): number {
  const [revealed, setRevealed] = useState(
    streaming && !reducedMotion ? '' : text,
  );
  const target = useRef(text);
  const frame = useRef<number | null>(null);
  const progress = useRef({
    position: revealed.length,
    published: revealed.length,
  });
  // A safety rejection or fallback replaces the answer instead of continuing old words.
  const immediate = !streaming || reducedMotion || !text.startsWith(revealed);

  useEffect(() => {
    target.current = text;
    if (immediate) {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      progress.current = { position: text.length, published: text.length };
      setRevealed(text);
      return;
    }
    if (frame.current !== null) {
      return;
    }
    let previous: number | null = null;
    const advance = (now: number) => {
      const destination = target.current;
      const current = progress.current;
      const elapsed =
        previous === null ? 0 : (now - previous) / MILLISECONDS_PER_SECOND;
      previous = now;
      const remaining = destination.length - current.position;
      current.position = Math.min(
        destination.length,
        current.position +
          elapsed * (CHARACTERS_PER_SECOND + remaining / CATCH_UP_SECONDS),
      );
      const next = Math.floor(current.position);
      if (
        next - current.published >= REVEAL_STEP ||
        next === destination.length
      ) {
        current.published = next;
        setRevealed(destination.slice(0, next));
      }
      frame.current =
        next < destination.length ? requestAnimationFrame(advance) : null;
    };
    frame.current = requestAnimationFrame(advance);
  }, [text, immediate]);

  useEffect(
    () => () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    },
    [],
  );

  return immediate ? text.length : revealed.length;
}
