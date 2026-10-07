import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../src/index.ts";

function makeEnv(overrides = {}) {
  const keys: string[] = [];
  return { keys, env: {
    ELEVENLABS_API_KEY: "voice-key", AGENT_ID: "agent/id", AGENT_LLM_SECRET: "secret",
    VOICE_MODEL: "voice-model", ANTHROPIC_API_KEY: "test-key", MODEL: "model", EFFORT: "low",
    LIMITER: { async limit({ key }: { key: string }) { keys.push(key); return { success: true }; } },
    ...overrides,
  } };
}

function request() {
  return new Request("https://worker.example/v1/voice/session", {
    method: "POST", headers: { "CF-Connecting-IP": "203.0.113.7" },
  });
}

async function assertError(response: Response, status: number, error: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error });
}

test("voice sessions issue uncached signed URLs using the agent id and server key", async (t) => {
  const input = request();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=agent%2Fid");
    assert.equal(options.method, "GET");
    assert.deepEqual(options.headers, { "xi-api-key": "voice-key" });
    assert.equal(options.signal, input.signal);
    return Response.json({ signed_url: "wss://agent.example/signed" });
  });
  const { env, keys } = makeEnv();
  const response = await handleRequest(input, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { signedUrl: "wss://agent.example/signed" });
  assert.deepEqual(keys, ["203.0.113.7"]);
});

test("missing configuration and failed limiting do not call ElevenLabs", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  for (const overrides of [{ ELEVENLABS_API_KEY: "" }, { AGENT_ID: "" }]) {
    await assertError(await handleRequest(request(), makeEnv(overrides).env), 503, "voice not configured");
  }
  const keys: string[] = [];
  const { env } = makeEnv({ LIMITER: { async limit({ key }) { keys.push(key); return { success: false }; } } });
  await assertError(await handleRequest(request(), env), 429, "rate limit exceeded");
  const noIp = request();
  noIp.headers.delete("CF-Connecting-IP");
  await assertError(await handleRequest(noIp, env), 429, "rate limit exceeded");
  assert.deepEqual(keys, ["203.0.113.7", "unknown"]);
  await assertError(await handleRequest(request(), makeEnv({
    LIMITER: { async limit() { throw new Error("private limiter detail"); } },
  }).env), 503, "rate limiter unavailable");
});

test("upstream failures map to stable voice errors without exposing details", async (t) => {
  let status = 401;
  let cancelled = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    cancel() { cancelled++; },
  }), { status }));
  const { env } = makeEnv();
  for (const [upstream, expected, error] of [
    [401, 502, "voice auth"], [403, 502, "voice auth"],
    [429, 429, "voice quota"], [500, 502, "voice unavailable"],
  ] as const) {
    status = upstream;
    await assertError(await handleRequest(request(), env), expected, error);
  }
  assert.equal(cancelled, 4);
});

test("missing signed URLs, invalid JSON and network errors make voice unavailable", async (t) => {
  let result = () => Promise.resolve(Response.json({ signed_url: 7 }));
  t.mock.method(globalThis, "fetch", () => result());
  const { env } = makeEnv();
  for (const body of [{}, { signed_url: "" }, { signed_url: 7 }, null]) {
    result = async () => Response.json(body);
    await assertError(await handleRequest(request(), env), 502, "voice unavailable");
  }
  result = async () => new Response("{");
  await assertError(await handleRequest(request(), env), 502, "voice unavailable");
  result = async () => { throw new Error("private API detail"); };
  await assertError(await handleRequest(request(), env), 502, "voice unavailable");
});
