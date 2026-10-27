import type { Pack } from '../../../pack/pack';
import {
  promptFor,
  PromptNotes,
  ReplyFormat,
  rulesFor,
} from '../../domain/grounding';
import { packKnowledge } from '../../domain/knowledge';
import type { InstructorModel } from '../../domain/turn/InstructorModel';
import type {
  Cancel,
  Clock,
  StreamingRequest,
  Timers,
} from '../../../../platform/ports';

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

const ANSWER_PATH = '/v1/answer';
const CONTENT_TYPE_HEADER = 'Content-Type';
const JSON_CONTENT_TYPE = 'application/json';
const HTTP_OK = 200;
const Failure = {
  unreadable: 'unreadable stream',
  badEvent: 'bad event',
  incomplete: 'stream ended early',
  network: 'network',
  firstText: 'no text in time',
  total: 'too slow',
  cancelled: 'cancelled',
} as const;

interface ProxyEvent {
  readonly text?: unknown;
  readonly done?: unknown;
  readonly error?: unknown;
}

export interface CloudModelOptions {
  readonly url: string | null;
  readonly isOnline?: () => boolean;
  readonly onFailure?: () => void;
  readonly clock: Clock;
  readonly timers: Timers;
  readonly streamingRequest: () => StreamingRequest;
}

/** The proxy retains the API key and streams one JSON object per line. */
export function createCloudModel({
  url,
  clock: now,
  timers,
  isOnline = () => true,
  onFailure,
  streamingRequest,
}: CloudModelOptions): InstructorModel {
  let offlineUntil = 0;
  let stopCurrent: (() => void) | null = null;

  return {
    isReady: () => url !== null && isOnline() && now() >= offlineUntil,
    prewarm() {
      // The first question sends the upstream cache hint; nothing to load here.
    },
    respond({ question, state, pack, history, evidence }, onText) {
      stopCurrent?.();
      return new Promise<string>((resolve, reject) => {
        const xhr = streamingRequest();
        let text = '';
        let consumed = 0;
        let finished = false;
        const deadlines: Cancel[] = [];
        const settle = () => {
          finished = true;
          deadlines.forEach(cancel => cancel());
          stopCurrent = null;
        };
        const fail = (reason: string, coolOff = true) => {
          if (finished) {
            return;
          }
          settle();
          if (coolOff) {
            onFailure?.();
            offlineUntil = now() + COOL_OFF_MS;
          }
          xhr.abort();
          reject(new Error(`Cloud model: ${reason}`));
        };
        const read = () => {
          if (finished || xhr.status !== HTTP_OK) {
            return;
          }
          const body = xhr.responseText;
          let end = body.indexOf('\n', consumed);
          while (end !== -1 && !finished) {
            const line = body.slice(consumed, end).trim();
            consumed = end + 1;
            end = body.indexOf('\n', consumed);
            if (line === '') {
              continue;
            }
            let event: ProxyEvent;
            try {
              event = JSON.parse(line);
            } catch {
              fail(Failure.unreadable);
              return;
            }
            if (
              event === null ||
              typeof event !== 'object' ||
              Array.isArray(event)
            ) {
              fail(Failure.badEvent);
              return;
            }
            if (event.error !== undefined) {
              fail(
                typeof event.error === 'string'
                  ? event.error
                  : Failure.badEvent,
              );
            } else if (typeof event.text === 'string') {
              text += event.text;
              if (text.trim() !== '') {
                deadlines[0]?.();
              }
              onText(text);
            } else if (event.done === true) {
              settle();
              resolve(text);
            } else {
              fail(Failure.badEvent);
            }
          }
        };
        xhr.onprogress = read;
        xhr.onload = () => {
          if (xhr.status !== HTTP_OK) {
            fail(`status ${xhr.status}`);
            return;
          }
          read();
          fail(Failure.incomplete);
        };
        xhr.onerror = () => fail(Failure.network);
        xhr.open('POST', `${url}${ANSWER_PATH}`);
        xhr.setRequestHeader(CONTENT_TYPE_HEADER, JSON_CONTENT_TYPE);
        xhr.send(
          JSON.stringify({
            system: cloudInstructions(pack),
            prompt: promptFor(
              question,
              state,
              pack,
              history.slice(-CLOUD_HISTORY_TURNS),
              PromptNotes.none,
              evidence,
            ),
          }),
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
