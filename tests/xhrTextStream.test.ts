import { streamTextOverXhr } from '../apps/field-guide/src/app/xhrTextStream';
import type { TextStream } from '../apps/field-guide/src/platform/ports';

const REQUEST = {
  url: 'https://proxy.example/v1/answer',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{"prompt":"Hi"}',
};
const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

/** The members of React Native's XMLHttpRequest the adapter drives, with the events it fires. */
function fakeXhr() {
  const xhr = {
    readyState: 0,
    status: 0,
    responseText: '',
    method: '',
    url: '',
    headers: {} as Record<string, string>,
    body: '',
    aborted: false,
    onreadystatechange: null as (() => void) | null,
    onprogress: null as (() => void) | null,
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    open(method: string, url: string) {
      xhr.method = method;
      xhr.url = url;
    },
    setRequestHeader(name: string, value: string) {
      xhr.headers[name] = value;
    },
    send(body: string) {
      xhr.body = body;
    },
    // React Native moves an aborted request to DONE, so a readiness handler sees it before the abort.
    abort() {
      xhr.aborted = true;
      xhr.status = 0;
      xhr.state(DONE);
    },
    state(readyState: number) {
      xhr.readyState = readyState;
      xhr.onreadystatechange?.();
    },
    respond(status: number) {
      xhr.status = status;
      xhr.state(HEADERS_RECEIVED);
    },
    progress(text: string) {
      xhr.responseText += text;
      xhr.state(LOADING);
      xhr.onprogress?.();
    },
    load(text = '') {
      xhr.responseText += text;
      xhr.state(DONE);
      xhr.onload?.();
    },
    error() {
      xhr.state(DONE);
      xhr.onerror?.();
    },
  };
  return xhr;
}

let xhr: ReturnType<typeof fakeXhr>;
const original = globalThis.XMLHttpRequest;
beforeEach(() => {
  xhr = fakeXhr();
  globalThis.XMLHttpRequest = jest.fn(
    () => xhr,
  ) as unknown as typeof XMLHttpRequest;
});
afterEach(() => {
  globalThis.XMLHttpRequest = original;
});

async function read(stream: TextStream, received: string[] = []) {
  for await (const chunk of stream.chunks) {
    received.push(chunk);
  }
  return received;
}

test('sends the request and resolves with the status once the headers arrive', async () => {
  const opened = streamTextOverXhr(REQUEST);
  expect(xhr).toMatchObject(REQUEST);
  xhr.respond(429);
  await expect(opened).resolves.toMatchObject({ status: 429 });
});

test('delivers the new response text of each progress and of the load, then ends', async () => {
  const opened = streamTextOverXhr(REQUEST);
  xhr.respond(200);
  const stream = await opened;
  xhr.progress('{"text":"It"}\n');
  xhr.progress('{"done":');
  xhr.load('true}\n');
  await expect(read(stream)).resolves.toEqual([
    '{"text":"It"}\n',
    '{"done":',
    'true}\n',
  ]);
});

test('a network failure before the headers rejects the request', async () => {
  const opened = streamTextOverXhr(REQUEST);
  xhr.error();
  await expect(opened).rejects.toThrow();
});

test('a network failure after the headers rejects the chunks after the text so far', async () => {
  const opened = streamTextOverXhr(REQUEST);
  xhr.respond(200);
  const stream = await opened;
  xhr.progress('{"text":"It"}\n');
  xhr.error();
  const received: string[] = [];
  await expect(read(stream, received)).rejects.toThrow();
  expect(received).toEqual(['{"text":"It"}\n']);
});

test('aborting before the headers stops the transfer and rejects with an AbortError', async () => {
  const controller = new AbortController();
  const opened = streamTextOverXhr({ ...REQUEST, signal: controller.signal });
  controller.abort();
  expect(xhr.aborted).toBe(true);
  await expect(opened).rejects.toMatchObject({ name: 'AbortError' });
});

test('aborting after the headers stops the transfer and rejects the chunks with an AbortError', async () => {
  const controller = new AbortController();
  const opened = streamTextOverXhr({ ...REQUEST, signal: controller.signal });
  xhr.respond(200);
  const stream = await opened;
  controller.abort();
  expect(xhr.aborted).toBe(true);
  await expect(read(stream)).rejects.toMatchObject({ name: 'AbortError' });
});
