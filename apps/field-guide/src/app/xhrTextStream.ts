import { createChunkChannel } from '../platform/chunkChannel';
import {
  ABORT_ERROR_NAME,
  ABORT_EVENT,
  type StreamText,
  type TextStream,
} from '../platform/ports';

// React Native sets the status when the request reaches this ready state, before any text.
const HEADERS_RECEIVED = 2;
const NETWORK_FAILED = 'Network request failed';
const ABORTED = 'Request aborted';

function abortError(): Error {
  return Object.assign(new Error(ABORTED), { name: ABORT_ERROR_NAME });
}

/**
 * Streams a response over React Native's XMLHttpRequest, whose fetch has no readable body.
 * The global is looked up per request because it only exists where React Native installs it.
 */
export const streamTextOverXhr: StreamText = ({
  url,
  method,
  headers,
  body,
  signal,
}) =>
  new Promise<TextStream>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const channel = createChunkChannel();
    let opened = false;
    let read = 0;
    const open = () => {
      if (!opened) {
        opened = true;
        resolve({ status: xhr.status, chunks: channel.chunks });
      }
    };
    const deliver = () => {
      const text = xhr.responseText;
      if (text.length > read) {
        channel.push(text.slice(read));
        read = text.length;
      }
    };
    const fail = (error: Error) => {
      signal?.removeEventListener(ABORT_EVENT, abort);
      if (opened) {
        channel.fail(error);
      } else {
        reject(error);
      }
    };
    const abort = () => {
      fail(abortError());
      xhr.abort();
    };
    signal?.addEventListener(ABORT_EVENT, abort);
    xhr.onreadystatechange = () => {
      if (xhr.readyState === HEADERS_RECEIVED) {
        open();
      }
    };
    // React Native only grows responseText while the request streams when a progress handler is set.
    xhr.onprogress = deliver;
    xhr.onload = () => {
      signal?.removeEventListener(ABORT_EVENT, abort);
      open();
      deliver();
      channel.end();
    };
    xhr.onerror = () => fail(new Error(NETWORK_FAILED));
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.send(body);
  });
