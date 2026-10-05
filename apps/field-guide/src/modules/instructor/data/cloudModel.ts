import type { Pack } from '../../../domain/pack';
import {
  promptFor,
  PromptNotes,
  ReplyFormat,
  rulesFor,
} from '../domain/grounding';
import type { InstructorModel } from '../domain/InstructorModel';

/** The instructor proxy (services/instructor-proxy); null keeps the instructor offline. */
export const INSTRUCTOR_PROXY_URL: string | null =
  'https://field-guide-instructor.field-guide-instructor-proxy.workers.dev';

// A spoken answer that has not started by then is better left to the on-device model.
export const FIRST_TEXT_MS = 6000;
export const TOTAL_MS = 25000;
// After a failure the network is likely still down, so the next questions skip the cloud
// for a while instead of each waiting for it to fail again.
export const COOL_OFF_MS = 30000;
// Enough of the conversation for a follow-up to lean on, while the prompt stays small.
export const CLOUD_HISTORY_TURNS = 4;

/**
 * Everything the pack knows: an upstream ephemeral cache hint can reuse these instructions,
 * while a large model can reason across parts rather than seeing only the notes picked for one.
 */
export function cloudInstructions(pack: Pack): string {
  const parts = pack.parts.map(part =>
    [
      `Part: ${part.name}${
        part.aliases.length > 0
          ? ` (also called ${part.aliases.join(', ')})`
          : ''
      }`,
      part.summary,
      ...part.notes.map(note => `${note.topic}: ${note.text}`),
    ].join('\n'),
  );
  const procedures = pack.procedures.map(
    procedure =>
      `${procedure.title}: ${procedure.steps
        .map(step =>
          [step.text, step.caution === '' ? '' : `Caution: ${step.caution}`]
            .filter(Boolean)
            .join(' '),
        )
        .join(' ')}`,
  );
  return [
    ...rulesFor(pack, ReplyFormat.structured),
    '',
    'Notes:',
    parts.join('\n\n'),
    '',
    'Guided checks in this guide:',
    procedures.join('\n'),
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
  readonly now?: () => number;
  readonly Request?: typeof XMLHttpRequest;
}

/** Claude through the proxy, which holds the API key and streams one JSON object per line. */
export function createCloudModel({
  url,
  now = Date.now,
  Request,
}: CloudModelOptions): InstructorModel {
  let offlineUntil = 0;
  let stopCurrent: (() => void) | null = null;

  return {
    isReady: () => url !== null && now() >= offlineUntil,
    prewarm() {
      // The first question sends the upstream cache hint; nothing to load here.
    },
    respond({ question, state, pack, history, evidence }, onText) {
      stopCurrent?.();
      return new Promise<string>((resolve, reject) => {
        // Looked up per request: the global only exists where React Native installs it.
        const xhr = new (Request ?? XMLHttpRequest)();
        let text = '';
        let consumed = 0;
        let finished = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const settle = () => {
          finished = true;
          timers.forEach(clearTimeout);
          stopCurrent = null;
        };
        const fail = (reason: string, coolOff = true) => {
          if (finished) {
            return;
          }
          settle();
          if (coolOff) {
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
                clearTimeout(timers[0]);
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
        timers.push(
          setTimeout(() => fail(Failure.firstText), FIRST_TEXT_MS),
          setTimeout(() => fail(Failure.total), TOTAL_MS),
        );
        stopCurrent = () => fail(Failure.cancelled, false);
      });
    },
    cancel() {
      stopCurrent?.();
    },
  };
}

export const cloudModel = createCloudModel({ url: INSTRUCTOR_PROXY_URL });
