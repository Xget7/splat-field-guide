import assert from "node:assert/strict";
import test from "node:test";
import worker, { handleRequest, validateInput } from "../src/index.ts";
import { sseToNdjson } from "../src/stream.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sse(name: string, data: unknown = { type: name }, ending = "\n") {
  return `event: ${name}${ending}data: ${JSON.stringify(data)}${ending}${ending}`;
}

function delta(text: string) {
  return sse("content_block_delta", { delta: { type: "text_delta", text } });
}

const completion = sse("message_delta", { delta: { stop_reason: "end_turn" } });
const stop = completion + sse("message_stop");

function source(parts: (string | Uint8Array)[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(typeof part === "string" ? encoder.encode(part) : part);
      }
      controller.close();
    },
  });
}

async function lines(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  assert.ok(text.endsWith("\n"));
  return text.trimEnd().split("\n").map((line) => JSON.parse(line));
}

test("text deltas stay in order and end with exactly one done line", async () => {
  const result = await lines(sseToNdjson(source([
    delta("Check "), delta("the oil.\n"), delta(""), stop,
    stop, delta("must not appear"), sse("error"),
  ])));
  assert.deepEqual(result, [
    { text: "Check " }, { text: "the oil.\n" }, { text: "" }, { done: true, stop: "end_turn" },
  ]);
});

test("events and UTF-8 characters can be split at every byte", async () => {
  const bytes = encoder.encode(delta("Café 🔧") + stop);
  const parts = Array.from(bytes, (byte) => Uint8Array.of(byte));
  assert.deepEqual(await lines(sseToNdjson(source(parts))), [
    { text: "Café 🔧" }, { done: true, stop: "end_turn" },
  ]);
});

test("multi-line data fields and split CRLF endings are parsed", async () => {
  const event = [
    ": keepalive", "id: 12", "retry: 1000", "event: content_block_delta",
    "data: {", 'data: "delta": {"type": "text_delta", "text": "oil"}',
    "data: }", "", "",
  ].join("\r\n") + completion + sse("message_stop", { type: "message_stop" }, "\r\n");
  const parts = Array.from(encoder.encode(event), (byte) => Uint8Array.of(byte));
  assert.deepEqual(await lines(sseToNdjson(source(parts))), [
    { text: "oil" }, { done: true, stop: "end_turn" },
  ]);
});

test("bare CR endings and data without a space after the colon work", async () => {
  const event = 'event:content_block_delta\rdata:{"delta":{"type":"text_delta","text":"brakes"}}\r\r';
  assert.deepEqual(await lines(sseToNdjson(source([
    event + completion + sse("message_stop", {}, "\r"),
  ]))), [{ text: "brakes" }, { done: true, stop: "end_turn" }]);
});

test("other event types and thinking or signature deltas are ignored", async () => {
  const ignored = [
    "ping", "message_start", "content_block_start", "content_block_stop",
    "message_delta", "future_event",
  ].map((name) => sse(name, { delta: { type: "text_delta", text: "ignore" } }));
  const thinking = sse("content_block_delta", {
    delta: { type: "thinking_delta", thinking: "private reasoning" },
  });
  const signature = sse("content_block_delta", {
    delta: { type: "signature_delta", signature: "private signature" },
  });
  assert.deepEqual(await lines(sseToNdjson(source([
    ...ignored, thinking, signature, delta("visible"), stop,
  ]))), [{ text: "visible" }, { done: true, stop: "end_turn" }]);
});

test("an error event emits one final error without exposing its payload", async () => {
  assert.deepEqual(await lines(sseToNdjson(source([
    delta("partial"),
    sse("error", { error: { type: "overloaded_error", message: "sensitive detail" } }),
    stop, delta("ignore"),
  ]))), [{ text: "partial" }, { error: "upstream error" }]);
});

test("EOF without message_stop emits one final error", async () => {
  assert.deepEqual(await lines(sseToNdjson(source([delta("partial")]))), [
    { text: "partial" }, { error: "upstream ended without message_stop" },
  ]);
  assert.deepEqual(await lines(sseToNdjson(source([]))), [
    { error: "upstream ended without message_stop" },
  ]);
});

test("an event without a terminating blank line is not dispatched at EOF", async () => {
  assert.deepEqual(await lines(sseToNdjson(source([stop.slice(0, -1)]))), [
    { error: "upstream ended without message_stop" },
  ]);
});

test("read failures become a final error line after any earlier text", async () => {
  let reads = 0;
  const input = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(encoder.encode(delta("partial")));
      else controller.error(new Error("sensitive failure detail"));
    },
  });
  assert.deepEqual(await lines(sseToNdjson(input)), [
    { text: "partial" }, { error: "upstream read failed" },
  ]);
});

test("malformed text events become a final error line", async () => {
  for (const payload of ["not JSON", '{"delta":{"type":"text_delta","text":42}}']) {
    const malformed = `event: content_block_delta\ndata: ${payload}\n\n`;
    assert.deepEqual(await lines(sseToNdjson(source([malformed, stop]))), [
      { error: "invalid upstream event" },
    ]);
  }
});

test("text is available while upstream remains open, and message_stop cancels it", async () => {
  let inputController: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const input = new ReadableStream<Uint8Array>({
    start(controller) { inputController = controller; },
    cancel() { cancelled = true; },
  });
  const reader = sseToNdjson(input).getReader();
  inputController.enqueue(encoder.encode(delta("first")));
  const first = await reader.read();
  assert.equal(decoder.decode(first.value), '{"text":"first"}\n');
  inputController.enqueue(encoder.encode(stop));
  const last = await reader.read();
  assert.equal(decoder.decode(last.value), '{"done":true,"stop":"end_turn"}\n');
  assert.equal((await reader.read()).done, true);
  assert.equal(cancelled, true);
});

test("consumer cancellation cancels upstream", async () => {
  let cancellation: unknown;
  const input = new ReadableStream<Uint8Array>({
    cancel(reason) { cancellation = reason; },
  });
  const reader = sseToNdjson(input).getReader();
  await reader.cancel("client disconnected");
  assert.equal(cancellation, "client disconnected");
});

test("validation rejects missing, empty, and non-string fields", () => {
  for (const input of [
    null, [], 1, "input", {}, { system: "s" }, { prompt: "p" },
    { system: "", prompt: "p" }, { system: "s", prompt: "" },
    { system: "   ", prompt: "p" }, { system: "s", prompt: "\n\t" },
    { system: 1, prompt: "p" }, { system: "s", prompt: false },
  ]) {
    const result = validateInput(input);
    assert.ok("error" in result);
    assert.equal(result.status, 400);
  }
});

test("validation accepts exact size limits and preserves the supplied strings", () => {
  const input = { system: "s".repeat(60000), prompt: "p".repeat(6000) };
  assert.deepEqual(validateInput(input), input);
  assert.deepEqual(validateInput({ system: " s ", prompt: " p ", model: "ignore" }), {
    system: " s ", prompt: " p ",
  });
});

test("validation returns 413 above either size limit", () => {
  assert.deepEqual(validateInput({ system: "s".repeat(60001), prompt: "p" }), {
    status: 413, error: "system too long",
  });
  assert.deepEqual(validateInput({ system: "s", prompt: "p".repeat(6001) }), {
    status: 413, error: "prompt too long",
  });
  assert.deepEqual(validateInput({ system: " ".repeat(60001), prompt: "p" }), {
    status: 413, error: "system too long",
  });
});

function makeEnv(success = true, overrides = {}) {
  const keys: string[] = [];
  const env = {
    ANTHROPIC_API_KEY: "test-api-key",
    MODEL: "claude-sonnet-5-5",
    EFFORT: "low",
    LIMITER: {
      async limit({ key }: { key: string }) {
        keys.push(key);
        return { success };
      },
    },
    ...overrides,
  };
  return { env, keys };
}

function request(body: unknown = { system: "instructor", prompt: "Check my oil" }) {
  return new Request("https://worker.example/v1/answer", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

async function assertError(response: Response, status: number, error: string) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("content-type") || "", /^application\/json/);
  assert.deepEqual(await response.json(), { error });
}

test("other paths return 404 and other methods return 405 before any upstream call", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  const { env, keys } = makeEnv();
  for (const method of ["GET", "POST"]) {
    await assertError(await handleRequest(new Request("https://worker.example/other", { method }), env),
      404, "not found");
  }
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
    const response = await handleRequest(new Request("https://worker.example/v1/answer", { method }), env);
    assert.equal(response.headers.get("allow"), "POST");
    await assertError(response, 405, "method not allowed");
  }
  assert.deepEqual(keys, []);
});

test("bad JSON, invalid fields, and oversized fields return JSON errors without fetching", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  const { env } = makeEnv();
  const invalidJSON = new Request("https://worker.example/v1/answer", { method: "POST", body: "{" });
  await assertError(await handleRequest(invalidJSON, env), 400, "invalid JSON");
  await assertError(await handleRequest(request({ system: "s" }), env), 400,
    "system and prompt must be non-empty strings");
  await assertError(await handleRequest(request({ system: "s".repeat(60001), prompt: "p" }), env),
    413, "system too long");
  await assertError(await handleRequest(request({ system: "s", prompt: "p".repeat(6001) }), env),
    413, "prompt too long");
});

test("the per-IP limiter returns 429 without making an upstream request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  const { env, keys } = makeEnv(false);
  await assertError(await handleRequest(request(), env), 429, "rate limit exceeded");
  assert.deepEqual(keys, ["203.0.113.7"]);
});

test("missing IP headers share a rate limit bucket", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  const { env, keys } = makeEnv(false);
  const input = request();
  input.headers.delete("CF-Connecting-IP");
  await assertError(await handleRequest(input, env), 429, "rate limit exceeded");
  assert.deepEqual(keys, ["unknown"]);
});

test("the handler sends only the fixed upstream request and streams NDJSON", async (t) => {
  let calls = 0;
  const input = request({
    system: "instructor", prompt: "Check my oil", model: "override",
    max_tokens: 999999, stream: false, messages: [], thinking: { budget_tokens: 999999 },
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(options.method, "POST");
    assert.deepEqual(options.headers, {
      "x-api-key": "test-api-key", "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    assert.equal(options.signal, input.signal);
    assert.deepEqual(JSON.parse(options.body), {
      model: "claude-sonnet-5-5", max_tokens: 1500, stream: true,
      system: [{ type: "text", text: "instructor", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "Check my oil" }],
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
    return new Response(source([
      sse("content_block_start", { content_block: { type: "text" } }),
      delta("Use the dipstick."), stop,
    ]));
  });
  const { env, keys } = makeEnv();
  const response = await worker.fetch(input, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await lines(response.body), [{ text: "Use the dipstick." }, { done: true, stop: "end_turn", blocks: ["text"] }]);
  assert.deepEqual(keys, ["203.0.113.7"]);
  assert.equal(calls, 1);
});

test("thinking deltas stay private", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    return new Response(source([
      sse("content_block_delta", { delta: { type: "thinking_delta", thinking: "private" } }),
      delta("answer"), stop,
    ]));
  });
  const { env } = makeEnv();
  const response = await handleRequest(request(), env);
  assert.deepEqual(await lines(response.body), [{ text: "answer" }, { done: true, stop: "end_turn" }]);
});

test("the handler rejects exhausted or incomplete answers", async (t) => {
  let reason = "max_tokens";
  t.mock.method(globalThis, "fetch", async () => new Response(source([
    sse("content_block_start", { content_block: { type: "text" } }),
    delta("Check the"),
    sse("message_delta", { delta: { stop_reason: reason } }),
    sse("message_stop"),
  ])));
  const { env } = makeEnv();
  for (reason of ["max_tokens", "pause_turn", "refusal", "tool_use", "unknown"]) {
    const response = await handleRequest(request(), env);
    assert.deepEqual(await lines(response.body), [
      { text: "Check the" }, { error: "upstream answer incomplete" },
    ]);
  }
});

test("empty text retains diagnostics and missing completion reasons fail", async (t) => {
  let completed = true;
  t.mock.method(globalThis, "fetch", async () => new Response(source([
    sse("content_block_start", { content_block: { type: "thinking" } }),
    delta(""), completed ? stop : sse("message_stop"),
  ])));
  const { env } = makeEnv();
  assert.deepEqual(await lines((await handleRequest(request(), env)).body), [
    { text: "" },
    { done: true, stop: "end_turn", blocks: ["thinking"],
      events: ["content_block_start", "content_block_delta", "message_delta", "message_stop"] },
  ]);
  completed = false;
  assert.deepEqual(await lines((await handleRequest(request(), env)).body), [
    { text: "" }, { error: "upstream answer incomplete" },
  ]);
});

test("upstream non-2xx statuses become 502 without leaking the body or key", async (t) => {
  let cancelled = 0;
  let status = 401;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode("sensitive upstream body test-api-key")); },
    cancel() { cancelled++; },
  }), { status }));
  const { env } = makeEnv();
  for (status of [401, 429, 500, 529]) {
    await assertError(await handleRequest(request(), env), 502, `upstream ${status}`);
  }
  assert.equal(cancelled, 4);
});

test("network errors return a sanitized 502", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("test-api-key sensitive failure"); });
  const { env } = makeEnv();
  await assertError(await handleRequest(request(), env), 502, "upstream unavailable");
});

test("a successful upstream response without a body returns 502", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  const { env } = makeEnv();
  await assertError(await handleRequest(request(), env), 502, "missing upstream stream");
});

test("missing secrets and limiter failures never send an upstream request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  const missing = makeEnv(true, { ANTHROPIC_API_KEY: "" });
  await assertError(await handleRequest(request(), missing.env), 500, "missing API key");
  const broken = makeEnv(true, {
    LIMITER: { async limit() { throw new Error("sensitive binding detail"); } },
  });
  await assertError(await handleRequest(request(), broken.env), 503, "rate limiter unavailable");
});
