import type { Pack } from '../../../pack/pack';
import {
  promptFor,
  PromptNotes,
  ReplyFormat,
  rulesFor,
} from '../../domain/grounding';
import { packKnowledge } from '../../domain/knowledge';
import type { InstructorModel } from '../../domain/turn/InstructorModel';
import type { Cancel, Clock, Timers } from '../../../../platform/ports';
import type { ProxyClient } from '../proxy/proxyClient';

// Fall back to on-device generation if the cloud takes too long to begin answering.
export const FIRST_TEXT_MS = 6000;
export const TOTAL_MS = 25000;
// Cool down after failure so subsequent questions do not each wait for another failed request.
export const COOL_OFF_MS = 30000;
export const CLOUD_HISTORY_TURNS = 4;

/** Cache the full pack instructions upstream so the model can reason across parts. */
export function cloudInstructions(pack: Pack): string {
  return [
    ...rulesFor(pack, ReplyFormat.structured),
    '',
    packKnowledge(pack),
  ].join('\n');
}

const Failure = {
  firstText: 'no text in time',
  total: 'too slow',
  cancelled: 'cancelled',
  noProxy: 'no proxy',
} as const;

export interface CloudModelOptions {
  readonly proxy: ProxyClient | null;
  readonly isOnline?: () => boolean;
  readonly onFailure?: () => void;
  readonly clock: Clock;
  readonly timers: Timers;
}

/** The proxy retains the API key and streams one JSON object per line. */
export function createCloudModel({
  proxy,
  clock: now,
  timers,
  isOnline = () => true,
  onFailure,
}: CloudModelOptions): InstructorModel {
  let offlineUntil = 0;
  let stopCurrent: (() => void) | null = null;

  return {
    isReady: () => proxy !== null && isOnline() && now() >= offlineUntil,
    prewarm() {
      // The first question sends the upstream cache hint; nothing to load here.
    },
    respond({ question, state, pack, history, evidence }, onText) {
      stopCurrent?.();
      return new Promise<string>((resolve, reject) => {
        if (proxy === null) {
          reject(new Error(`Cloud model: ${Failure.noProxy}`));
          return;
        }
        let finished = false;
        const deadlines: Cancel[] = [];
        const settle = () => {
          finished = true;
          deadlines.forEach(cancel => cancel());
          stopCurrent = null;
        };
        const answer = proxy.answer(
          {
            system: cloudInstructions(pack),
            prompt: promptFor(
              question,
              state,
              pack,
              history.slice(-CLOUD_HISTORY_TURNS),
              PromptNotes.none,
              evidence,
            ),
          },
          text => {
            if (finished) {
              return;
            }
            if (text.trim() !== '') {
              deadlines[0]?.();
            }
            onText(text);
          },
        );
        const fail = (reason: string, coolOff = true) => {
          if (finished) {
            return;
          }
          settle();
          if (coolOff) {
            onFailure?.();
            offlineUntil = now() + COOL_OFF_MS;
          }
          answer.cancel();
          reject(new Error(`Cloud model: ${reason}`));
        };
        answer.text.then(
          text => {
            if (!finished) {
              settle();
              resolve(text);
            }
          },
          (error: Error) => fail(error.message),
        );
        deadlines.push(
          timers.after(FIRST_TEXT_MS, () => fail(Failure.firstText)),
          timers.after(TOTAL_MS, () => fail(Failure.total)),
        );
        stopCurrent = () => fail(Failure.cancelled, false);
      });
    },
    cancel() {
      stopCurrent?.();
    },
  };
}
