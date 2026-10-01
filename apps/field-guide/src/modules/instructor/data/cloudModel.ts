import type { Pack } from '../../../domain/pack';
import {
  Grounding,
  promptFor,
  PromptNotes,
  rulesFor,
} from '../domain/grounding';
import { ModelName, type InstructorModel } from '../domain/InstructorModel';

/** The instructor proxy (services/instructor-proxy); null keeps the instructor offline. */
export const INSTRUCTOR_PROXY_URL: string | null =
  'https://field-guide-instructor.field-guide-instructor-proxy.workers.dev';

// A spoken answer that has not started by then is better left to the on-device model.
export const FIRST_TEXT_MS = 6000;
export const TOTAL_MS = 25000;
// After a failure the network is likely still down, so the next questions skip the cloud
// for a while instead of each waiting for it to fail again.
export const COOL_OFF_MS = 30000;

/**
 * Everything the pack knows, once per pack: the proxy caches it, and a large model can
 * reason across parts instead of seeing only the notes picked for one.
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
      `${procedure.title}: ${procedure.steps.map(step => step.text).join(' ')}`,
  );
  return [
    ...rulesFor(pack, Grounding.flagged),
    '',
    'Notes:',
    parts.join('\n\n'),
    '',
    'Guided checks in this guide:',
    procedures.join('\n'),
  ].join('\n');
}

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
    name: ModelName.cloud,
    isReady: () => url !== null && now() >= offlineUntil,
    prewarm() {
      // The proxy caches the instructions on the first question; nothing to load here.
    },
    respond({ question, state, pack, previous }, onText) {
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
          if (finished || xhr.status !== 200) {
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
              fail('unreadable stream');
              return;
            }
            if (typeof event.text === 'string') {
              text += event.text;
              clearTimeout(timers[0]);
              onText(text);
            } else if (event.done === true) {
              settle();
              resolve(text);
            } else {
              fail(typeof event.error === 'string' ? event.error : 'bad event');
            }
          }
        };
        xhr.onprogress = read;
        xhr.onload = () => {
          if (xhr.status !== 200) {
            fail(`status ${xhr.status}`);
            return;
          }
          read();
          fail('stream ended early');
        };
        xhr.onerror = () => fail('network');
        xhr.open('POST', `${url}/v1/answer`);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(
          JSON.stringify({
            system: cloudInstructions(pack),
            prompt: promptFor(
              question,
              state,
              pack,
              previous,
              PromptNotes.none,
            ),
          }),
        );
        timers.push(
          setTimeout(() => fail('no text in time'), FIRST_TEXT_MS),
          setTimeout(() => fail('too slow'), TOTAL_MS),
        );
        stopCurrent = () => fail('cancelled', false);
      });
    },
    cancel() {
      stopCurrent?.();
    },
  };
}

export const cloudModel = createCloudModel({ url: INSTRUCTOR_PROXY_URL });
