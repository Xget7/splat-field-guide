import type { Cancel, Clock, Timers } from '../../../../platform/ports';

export const ReplyTiming = {
  // Fall back to the next answerer if the reply takes too long to begin.
  FIRST_TEXT_MS: 6000,
  TOTAL_MS: 25000,
  // Cool down after a failure so later questions do not each wait for another failed request.
  COOL_OFF_MS: 30000,
} as const;

/** Why a streamed reply stopped being worth waiting for. */
export const ReplyFailure = {
  slowStart: 'slowStart',
  slowReply: 'slowReply',
  failed: 'failed',
} as const;
export type ReplyFailure = (typeof ReplyFailure)[keyof typeof ReplyFailure];
const ReplyMessage = {
  slowStart: 'no text in time',
  slowReply: 'too slow',
  cancelled: 'cancelled',
  failed: 'failed',
} as const;

/** One reply as it streams: its full text once done, and a cancel that stops it. */
export interface StreamedReply {
  readonly text: Promise<string>;
  cancel(): void;
}

export interface ReplyPolicy {
  /** False during the cool-off after a failure. */
  ready(): boolean;
  /** Starts a reply in place of the current one and waits for it within the deadlines. */
  run(
    start: (onText: (text: string) => void) => StreamedReply,
    onText: (text: string) => void,
  ): Promise<string>;
  /** Rejects the current reply without a cool-off; safe when idle. */
  cancel(): void;
}

export interface ReplyPolicyOptions {
  readonly clock: Clock;
  readonly timers: Timers;
  /** Each failure by kind, so the caller decides what it says about the network. */
  readonly onFailure?: (failure: ReplyFailure) => void;
}

export function createReplyPolicy({
  clock: now,
  timers,
  onFailure,
}: ReplyPolicyOptions): ReplyPolicy {
  let coolUntil = 0;
  let stopCurrent: (() => void) | null = null;
  return {
    ready: () => now() >= coolUntil,
    run(start, onText) {
      stopCurrent?.();
      return new Promise<string>((resolve, reject) => {
        let finished = false;
        const deadlines: Cancel[] = [];
        const settle = () => {
          finished = true;
          deadlines.forEach(cancel => cancel());
          stopCurrent = null;
        };
        const reply = start(text => {
          if (finished) {
            return;
          }
          if (text.trim() !== '') {
            deadlines[0]?.();
          }
          onText(text);
        });
        const stop = (message: string, failure?: ReplyFailure) => {
          if (finished) {
            return;
          }
          settle();
          if (failure !== undefined) {
            onFailure?.(failure);
            coolUntil = now() + ReplyTiming.COOL_OFF_MS;
          }
          reply.cancel();
          reject(new Error(message));
        };
        reply.text.then(
          text => {
            if (!finished) {
              settle();
              resolve(text);
            }
          },
          (error: unknown) =>
            stop(
              error instanceof Error ? error.message : ReplyMessage.failed,
              ReplyFailure.failed,
            ),
        );
        deadlines.push(
          timers.after(ReplyTiming.FIRST_TEXT_MS, () =>
            stop(ReplyMessage.slowStart, ReplyFailure.slowStart),
          ),
          timers.after(ReplyTiming.TOTAL_MS, () =>
            stop(ReplyMessage.slowReply, ReplyFailure.slowReply),
          ),
        );
        stopCurrent = () => stop(ReplyMessage.cancelled);
      });
    },
    cancel() {
      stopCurrent?.();
    },
  };
}
