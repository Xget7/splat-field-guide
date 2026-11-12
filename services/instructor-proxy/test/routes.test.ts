import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.ts';
const env = { ELEVENLABS_API_KEY: '', AGENT_ID: '', LIMITER: { limit: async () => ({ success: true }) } };
test('only ping and signed-session issuance remain; removed model proxy routes cannot call a provider', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('unexpected provider request'));
  for (const path of ['/v1/answer', '/v1/chat/completions', '/unknown']) {
    assert.equal((await handleRequest(new Request(`https://worker.example${path}`, { method: 'POST' }), env)).status, 404);
  }
  const ping = await handleRequest(new Request('https://worker.example/v1/ping'), env);
  assert.equal(ping.status, 204);
  assert.equal(ping.headers.get('cache-control'), 'no-store');
  const wrong = await handleRequest(new Request('https://worker.example/v1/voice/session'), env);
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'POST');
});
