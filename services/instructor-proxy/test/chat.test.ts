import assert from "node:assert/strict";
import test from "node:test";
import { buildChatUpstreamBody, validateChatInput } from "../src/chat.ts";
import { handleRequest } from "../src/index.ts";

const env = { VOICE_MODEL: "voice-model" };
const user = { role: "user", content: "Where is the oil?" } as const;

test("system messages join in one cached block and user text blocks merge by role", () => {
  const result = buildChatUpstreamBody({ stream: true, messages: [
    { role: "system", content: "Be brief." }, user,
    { role: "system", content: [{ type: "text", text: "Stay grounded." }] },
    { role: "user", content: [{ type: "text", text: "Show me." }] },
  ] }, env);
  assert.deepEqual(result.system, [{ type: "text", text: "Be brief.\nStay grounded.", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(result.messages, [{ role: "user", content: [
    { type: "text", text: "Where is the oil?" }, { type: "text", text: "Show me." },
  ] }]);
});

test("assistant openings and system-only conversations have a starter user message", () => {
  for (const messages of [[{ role: "assistant", content: "Welcome." }], [{ role: "system", content: "Be brief." }], []]) {
    const result = buildChatUpstreamBody({ stream: true, messages }, env);
    assert.deepEqual(result.messages[0], { role: "user", content: [{ type: "text", text: "(The conversation starts.)" }] });
  }
});

test("assistant tool calls and results keep ids and merge adjacent user blocks", () => {
  const result = buildChatUpstreamBody({ stream: true, messages: [user, {
    role: "assistant", content: "Here it is.", tool_calls: [
      { id: "call-1", type: "function", function: { name: "show_part", arguments: '{"part_id":"oil"}' } },
      { id: "call-2", type: "function", function: { name: "next_step", arguments: "" } },
      { id: "call-3", type: "function", function: { name: "repeat_step", arguments: "{" } },
    ],
  }, { role: "tool", tool_call_id: "call-1", content: "Oil selected." },
  { role: "tool", tool_call_id: "call-2", content: "Next step." }, user] }, env);
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
});

test("tools and all tool choices use Messages API forms", () => {
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

test("voice generation caps tokens, passes temperature and ignores caller model and thinking", () => {
  for (const [tokens, expected] of [[undefined, 600], [75, 75], [900, 600]]) {
    const result = buildChatUpstreamBody({ stream: true, messages: [user], max_tokens: tokens,
      temperature: 0.3, model: "ignored", thinking: { type: "adaptive" }, user_id: "ignored",
      elevenlabs_extra_body: {}, stream_options: {}, output_config: {} }, env);
    assert.equal(result.max_tokens, expected);
    assert.equal(result.model, "voice-model");
    assert.equal(result.temperature, 0.3);
    assert.equal(result.stream, true);
    for (const key of ["thinking", "output_config", "user_id", "elevenlabs_extra_body", "stream_options"]) assert.ok(!(key in result));
  }
});

test("validation rejects malformed chat bodies and enforces the serialized size limit", () => {
  for (const value of [null, [], {}, { stream: true, messages: [] }, { stream: false, messages: [user] },
    { stream: true, messages: [null] }, { stream: true, messages: [{ role: "unknown", content: "text" }] }]) {
    assert.equal(validateChatInput(value).status, 400);
  }
  const body = { stream: true, messages: [user], ignored: "x".repeat(200000) };
  assert.deepEqual(validateChatInput(body), { status: 413, error: "request too large" });
  const exact = { stream: true, messages: [user], padding: "" };
  exact.padding = "x".repeat(200000 - JSON.stringify(exact).length);
  assert.ok(!("error" in validateChatInput(exact)));
  exact.padding += "x";
  assert.deepEqual(validateChatInput(exact), { status: 413, error: "request too large" });
  assert.deepEqual(validateChatInput({ stream: true, messages: [user] }), { stream: true, messages: [user] });
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
async function chatError(response: Response, status: number, error: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error });
}
async function chatChunks(response: Response) {
  const text = await response.text();
  return text.trimEnd().split("\n\n").map((line) => line === "data: [DONE]" ? "[DONE]" : JSON.parse(line.slice(6)));
}

test("missing or wrong bearer and empty secrets never call upstream", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  for (const bearer of [null, "wrong", "Bearer wrong", "Bearer sëcre", "Bearer sëcretextra", "Bearer "]) {
    await chatError(await handleRequest(chatRequest(undefined, bearer), endpointEnv), 401, "unauthorized");
  }
  await chatError(await handleRequest(chatRequest(), { ...endpointEnv, AGENT_LLM_SECRET: "" }), 401, "unauthorized");
});

test("authorized streaming chat calls Claude with the voice model and streams SSE", async (t) => {
  const input = chatRequest({ stream: true, messages: [user], error: "caller error", status: 418 });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(options.method, "POST");
    assert.equal(options.signal, input.signal);
    assert.deepEqual(options.headers, { "x-api-key": "test-api-key", "anthropic-version": "2023-06-01", "content-type": "application/json" });
    const body = JSON.parse(options.body);
    assert.equal(body.model, "voice-model");
    assert.equal(body.max_tokens, 600);
    assert.ok(!("thinking" in body));
    return new Response('event: message_start\ndata: {}\n\nevent: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Check the dipstick."}}\n\nevent: message_delta\ndata: {"delta":{"stop_reason":"end_turn"}}\n\nevent: message_stop\ndata: {}\n\n');
  });
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
});

test("invalid chat requests fail before fetching, including the size boundary", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  await chatError(await handleRequest(chatRequest("{"), endpointEnv), 400, "invalid JSON");
  await chatError(await handleRequest(chatRequest({ stream: false, messages: [user] }), endpointEnv), 400, "stream must be true");
  await chatError(await handleRequest(chatRequest({ stream: true, messages: [] }), endpointEnv), 400, "messages must be a non-empty array of chat messages");
  await chatError(await handleRequest(chatRequest({ stream: true, messages: [user], padding: "x".repeat(200000) }), endpointEnv), 413, "request too large");
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
    assert.ok(content.every((chunk) => chunk.length <= 120));
    if (text.startsWith("Check") && text.length > 120) assert.ok(content.slice(0, -1).every((chunk) => chunk.endsWith(" ")));
    assert.equal(result.at(-2).choices[0].finish_reason, "stop");
    assert.equal(result.at(-1), "[DONE]");
  }
});

test("chat upstream failures use the answer route's sanitized errors", async (t) => {
  let upstream = async () => new Response(null, { status: 204 });
  t.mock.method(globalThis, "fetch", () => upstream());
  await chatError(await handleRequest(chatRequest(), endpointEnv), 502, "missing upstream stream");
  for (const status of [401, 429, 500]) {
    upstream = async () => new Response("private detail", { status });
    await chatError(await handleRequest(chatRequest(), endpointEnv), 502, `upstream ${status}`);
  }
  upstream = async () => { throw new Error("private detail"); };
  await chatError(await handleRequest(chatRequest(), endpointEnv), 502, "upstream unavailable");
  await chatError(await handleRequest(chatRequest(), { ...endpointEnv, ANTHROPIC_API_KEY: "" }), 500, "missing API key");
});
