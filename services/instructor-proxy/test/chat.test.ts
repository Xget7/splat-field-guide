import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { buildChatUpstreamBody, VOICE_EFFORT, VOICE_MAX_TOKENS, VOICE_THINKING, MAX_CHAT_BODY_CHARS } from "../src/chat.ts";
import { NARRATION_CHUNK_CHARS } from "../src/narration.ts";
import { assertError } from "./helpers.ts";
import { handleRequest } from "../src/index.ts";

const env = { VOICE_MODEL: "voice-model" };
const user = { role: "user", content: "Where is the oil?" } as const;

test("text translation caches instructions, drops blank blocks and supplies a conversation opening", () => {
  const result = buildChatUpstreamBody({ stream: true, messages: [
    { role: "system", content: "Be brief." }, user,
    { role: "system", content: [{ type: "text", text: "Stay grounded." }] },
    { role: "user", content: [{ type: "text", text: "   " }, { type: "text", text: "Show me." }] },
    { role: "assistant", content: "\t  " },
    { role: "system", content: "\n  " },
  ] }, env);
  assert.deepEqual(result.system, [{ type: "text", text: "Be brief.\nStay grounded.", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(result.messages, [{ role: "user", content: [
    { type: "text", text: "Where is the oil?" }, { type: "text", text: "Show me." },
  ] }]);
  for (const messages of [[{ role: "assistant", content: "Welcome." }], [{ role: "system", content: "Be brief." }],
    [{ role: "system", content: "  " }, { role: "user", content: "\t" }], []]) {
    const result = buildChatUpstreamBody({ stream: true, messages }, env);
    assert.deepEqual(result.messages[0], { role: "user", content: [{ type: "text", text: "(The conversation starts.)" }] });
    if (messages.every((message) => !message.content.trim())) assert.ok(!("system" in result));
  }
  assert.deepEqual(buildChatUpstreamBody({ stream: true, messages: [user, { role: "assistant", content: "Ready." }] }, env)
    .messages.at(-1), { role: "user", content: [{ type: "text", text: "(Continue.)" }] });
});

test("tools preserve calls and schemas and place results before text in merged user turns", () => {
  const result = buildChatUpstreamBody({ stream: true, messages: [user, {
    role: "assistant", content: "Here it is.", tool_calls: [
      { id: "call-1", type: "function", function: { name: "show_part", arguments: '{"part_id":"oil"}' } },
      { id: "call-2", type: "function", function: { name: "next_step", arguments: "" } },
      { id: "call-3", type: "function", function: { name: "repeat_step", arguments: "{" } },
    ],
  }, user, { role: "tool", tool_call_id: "call-1", content: "Oil selected." },
  { role: "tool", tool_call_id: "call-2", content: "Next step." }] }, env);
  assert.deepEqual(result.messages.slice(1), [{ role: "assistant", content: [
    { type: "text", text: "Here it is." },
    { type: "tool_use", id: "call-1", name: "show_part", input: { part_id: "oil" } },
    { type: "tool_use", id: "call-2", name: "next_step", input: {} },
    { type: "tool_use", id: "call-3", name: "repeat_step", input: {} },
  ] }, { role: "user", content: [
    { type: "tool_result", tool_use_id: "call-1", content: "Oil selected." },
    { type: "tool_result", tool_use_id: "call-2", content: "Next step." },
    { type: "text", text: "Where is the oil?" },
  ] }]);

  const onlyTools = buildChatUpstreamBody({ stream: true, messages: [user, {
    role: "assistant", content: "  ", tool_calls: [
      { id: "call-only", type: "function", function: { name: "next_step", arguments: "{}" } },
    ],
  }] }, env);
  assert.deepEqual(onlyTools.messages[1], { role: "assistant", content: [
    { type: "tool_use", id: "call-only", name: "next_step", input: {} },
  ] });
  const tools = [
    { type: "function", function: { name: "next_step", description: "Advance." } },
    { type: "function", function: { name: "show_part", parameters: { type: "object", properties: { part_id: { type: "string" } } } } },
  ] as const;
  for (const [choice, expected] of [
    [undefined, undefined], ["auto", { type: "auto" }], ["required", { type: "any" }],
    ["none", { type: "none" }], [{ type: "function", function: { name: "next_step" } }, { type: "tool", name: "next_step" }],
  ]) {
    const result = buildChatUpstreamBody({ stream: true, messages: [user], tools, tool_choice: choice }, env);
    assert.deepEqual(result.tool_choice, expected);
    assert.deepEqual(result.tools, [
      { name: "next_step", description: "Advance.", input_schema: { type: "object", properties: {} } },
      { name: "show_part", input_schema: { type: "object", properties: { part_id: { type: "string" } } } },
    ]);
  }
});

const endpointEnv = {
  VOICE_MODEL: "voice-model", ANTHROPIC_API_KEY: "test-api-key", AGENT_LLM_SECRET: "sëcret",
  ELEVENLABS_API_KEY: "voice-key", AGENT_ID: "agent-id", MODEL: "typed-model", EFFORT: "low",
  LIMITER: { async limit() { assert.fail("chat must not use the per-IP limiter"); } },
};
function chatRequest(body: unknown = { stream: true, messages: [user] }, bearer: string | null = "Bearer sëcret") {
  const headers = new Headers({ "content-type": "application/json" });
  if (bearer !== null) headers.set("authorization", bearer);
  return new Request("https://worker.example/v1/chat/completions", { method: "POST", headers,
    body: typeof body === "string" ? body : JSON.stringify(body) });
}
async function chatChunks(response: Response) {
  const text = await response.text();
  return text.trimEnd().split("\n\n").map((line) => line === "data: [DONE]" ? "[DONE]" : JSON.parse(line.slice(6)));
}

test("invalid credentials and malformed requests fail before upstream calls", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  for (const bearer of [null, "wrong", "Bearer wrong", "Bearer sëcre", "Bearer sëcretextra", "Bearer "]) {
    await assertError(await handleRequest(chatRequest(undefined, bearer), endpointEnv), 401, "unauthorized");
  }
  await assertError(await handleRequest(chatRequest(), { ...endpointEnv, AGENT_LLM_SECRET: "" }), 401, "unauthorized");
  for (const options of [{ tools: {} }, { tools: [null] }, { tool_choice: {} }, { tool_choice: "invalid" }]) {
    await assertError(await handleRequest(chatRequest({ stream: true, messages: [user], ...options }), endpointEnv), 400, "invalid chat options");
  }
  await assertError(await handleRequest(chatRequest("{"), endpointEnv), 400, "invalid JSON");
  for (const body of [null, [], {}]) {
    await assertError(await handleRequest(chatRequest(body), endpointEnv), 400,
      body !== null && !Array.isArray(body) ? "messages must be a non-empty array of chat messages" : "expected JSON object");
  }
  for (const message of [null, { role: "unknown", content: "text" }, { role: "user", content: 7 }]) {
    await assertError(await handleRequest(chatRequest({ stream: true, messages: [message] }), endpointEnv), 400,
      "messages must be a non-empty array of chat messages");
  }
  await assertError(await handleRequest(chatRequest({ stream: false, messages: [user] }), endpointEnv), 400, "stream must be true");
  await assertError(await handleRequest(chatRequest({ stream: true, messages: [] }), endpointEnv), 400, "messages must be a non-empty array of chat messages");
  await assertError(await handleRequest(chatRequest({ stream: true, messages: [user], padding: "x".repeat(MAX_CHAT_BODY_CHARS) }), endpointEnv), 413, "request too large");

});

test("authorized chat normalizes generation options and streams Claude with the voice model", async (t) => {
  let input: Request;
  let expectedTokens = VOICE_MAX_TOKENS;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(options.method, "POST");
    assert.equal(options.signal.aborted, false);
    assert.deepEqual(options.headers, {
      "x-api-key": "test-api-key", "anthropic-version": "2023-06-01", "content-type": "application/json",
    });
    const body = JSON.parse(options.body);
    assert.equal(body.model, "voice-model");
    assert.equal(body.max_tokens, expectedTokens);
    assert.deepEqual(body.thinking, VOICE_THINKING);
    assert.deepEqual(body.output_config, { effort: VOICE_EFFORT });
    for (const key of ["temperature", "tools", "tool_choice", "user_id", "elevenlabs_extra_body", "stream_options"]) {
      assert.ok(!(key in body));
    }
    return new Response('event: message_start\ndata: {}\n\nevent: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Check the dipstick."}}\n\nevent: message_delta\ndata: {"delta":{"stop_reason":"end_turn"}}\n\nevent: message_stop\ndata: {}\n\n');
  });
  // The voice model only takes its default sampling, so a caller's temperature never reaches it.
  for (const [tokens, temperature, outputTokens] of [
    [undefined, undefined, VOICE_MAX_TOKENS], [null, null, VOICE_MAX_TOKENS],
    [75, 0.3, 75], [VOICE_MAX_TOKENS + 1, 0, VOICE_MAX_TOKENS],
    [0, "warm", VOICE_MAX_TOKENS], [-1, {}, VOICE_MAX_TOKENS],
    [1.5, NaN, VOICE_MAX_TOKENS], ["75", Infinity, VOICE_MAX_TOKENS],
  ]) {
    expectedTokens = outputTokens;
    const requestBody = { stream: true, messages: [user], error: "caller error", status: 418,
      max_tokens: tokens, temperature, tools: null, tool_choice: null,
      model: "ignored", thinking: { type: "adaptive" }, output_config: {},
      user_id: "ignored", elevenlabs_extra_body: {}, stream_options: {} };
    const translated = buildChatUpstreamBody(requestBody, env);
    assert.equal(translated.max_tokens, expectedTokens);
    assert.ok(!("temperature" in translated));
    input = chatRequest(requestBody);
    const response = await handleRequest(input, endpointEnv);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await chatChunks(response);
    assert.equal(result[1].choices[0].delta.content, "Check the dipstick.");
    assert.equal(result.at(-1), "[DONE]");
    assert.ok(result[0].id.startsWith("chatcmpl-"));
    assert.equal(result[0].model, "voice-model");
    assert.ok(Number.isInteger(result[0].created));
  }
  const exactBody = { stream: true, messages: [user], padding: "" };
  exactBody.padding = "x".repeat(MAX_CHAT_BODY_CHARS - JSON.stringify(exactBody).length);
  expectedTokens = VOICE_MAX_TOKENS;
  input = chatRequest(exactBody);
  const response = await handleRequest(input, endpointEnv);
  assert.equal(response.status, 200);
  assert.equal((await chatChunks(response)).at(-1), "[DONE]");
});

test("narration is verbatim, chunked at spaces and completes without upstream calls", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("narration must not fetch"));
  for (const text of ["Check the oil.  Then replace the cap.\n", "Check the oil. ".repeat(30), "x".repeat(250), ""]) {
    const response = await handleRequest(chatRequest({ stream: true, messages: [
      user, { role: "assistant", content: "Ready." },
      { role: "user", content: [{ type: "text", text: `[narrate] ${text}` }] },
      { role: "system", content: "Be brief." },
    ] }), { ...endpointEnv, ANTHROPIC_API_KEY: "" });
    assert.equal(response.status, 200);
    const result = await chatChunks(response);
    assert.deepEqual(result[0].choices[0].delta, { role: "assistant", content: "" });
    const content = result.slice(1, -2).map((chunk) => chunk.choices[0].delta.content);
    assert.equal(content.join(""), text);
    assert.ok(content.every((chunk) => chunk.length <= NARRATION_CHUNK_CHARS));
    if (text.startsWith("Check") && text.length > NARRATION_CHUNK_CHARS) assert.ok(content.slice(0, -1).every((chunk) => chunk.endsWith(" ")));
    assert.equal(result.at(-2).choices[0].finish_reason, "stop");
    assert.equal(result.at(-1), "[DONE]");
  }
});

test("chat upstream failures use the answer route's sanitized errors", async (t) => {
  let upstream = async () => new Response(null, { status: 204 });
  t.mock.method(globalThis, "fetch", () => upstream());
  await assertError(await handleRequest(chatRequest(), endpointEnv), 502, "missing upstream stream");
  for (const status of [401, 429, 500]) {
    upstream = async () => new Response("private detail", { status });
    await assertError(await handleRequest(chatRequest(), endpointEnv), 502, `upstream ${status}`);
  }
  upstream = async () => { throw new Error("private detail"); };
  await assertError(await handleRequest(chatRequest(), endpointEnv), 502, "upstream unavailable");
  await assertError(await handleRequest(chatRequest(), { ...endpointEnv, ANTHROPIC_API_KEY: "" }), 500, "missing API key");
});

test("a stalled chat connection aborts upstream and returns one SSE error after ten seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal;
  let started: () => void;
  const connecting = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    started();
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("private detail")), { once: true });
    });
  });
  const pending = handleRequest(chatRequest(), endpointEnv);
  await connecting;
  t.mock.timers.tick(9999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(signal.aborted, true);
  const response = await pending;
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.deepEqual(await chatChunks(response), [
    { error: { message: "upstream stream failed", type: "upstream_error" } },
  ]);
});

test("chat inactivity expires after fifteen seconds without bytes and cancels upstream", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  let signal: AbortSignal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value; value.enqueue(new TextEncoder().encode('event: message_start\ndata: {}\n\n')); },
      cancel() { cancelled = true; },
    }));
  });
  const response = await handleRequest(chatRequest(), endpointEnv);
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"role":"assistant"/);
  const pending = reader.read();
  await setImmediate();
  t.mock.timers.tick(14999);
  assert.equal(signal.aborted, false);
  assert.equal(cancelled, false);
  controller.enqueue(new TextEncoder().encode(': ping\n\n'));
  await setImmediate();
  t.mock.timers.tick(14999);
  assert.equal(cancelled, false);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(cancelled, true);
  assert.equal(new TextDecoder().decode((await pending).value),
    'data: {"error":{"message":"upstream stream failed","type":"upstream_error"}}\n\n');
  assert.equal((await reader.read()).done, true);
});
