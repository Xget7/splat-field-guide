import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../src/index.ts";

const env = {
  ANTHROPIC_API_KEY: "test-key", MODEL: "test-model", EFFORT: "low",
  LIMITER: { async limit() { assert.fail("unexpected limiter call"); } },
};

test("quality probes return an empty uncached response without limiting or fetching", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  const response = await handleRequest(new Request("https://worker.example/v1/ping"), env);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("routing rejects wrong methods and unknown paths before limiting", async () => {
  const response = await handleRequest(new Request("https://worker.example/v1/ping", { method: "POST" }), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.deepEqual(await response.json(), { error: "method not allowed" });
  const unknown = await handleRequest(new Request("https://worker.example/unknown"), env);
  assert.equal(unknown.status, 404);
});

test("the answer route still validates the supplied prompt", async (t) => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected upstream fetch"));
  const response = await handleRequest(new Request("https://worker.example/v1/answer", {
    method: "POST", body: JSON.stringify({ system: "instructor" }),
  }), { ...env, LIMITER: { async limit() { return { success: true }; } } });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "system and prompt must be non-empty strings" });
});
