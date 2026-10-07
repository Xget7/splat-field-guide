import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../src/sync.ts';
import { pronunciationRules } from '../src/pronunciation.ts';

const env = {
  ELEVENLABS_API_KEY: 'test-api-key', AGENT_LLM_SECRET: 'test-llm-secret',
  WORKER_URL: 'https://worker.example', VOICE_ID: 'owner-voice',
};
interface ApiCall {
  method: string;
  path: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function fakeApi(dictionaryRules: readonly unknown[] = pronunciationRules) {
  const calls: ApiCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.elevenlabs.io');
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const call = { method: init?.method ?? 'GET', path: url.pathname, headers: new Headers(init?.headers), body };
    calls.push(call);
    if (url.pathname.startsWith('/v1/convai/secrets')) return Response.json({ secret_id: 'secret-created' });
    if (url.pathname.startsWith('/v1/convai/tools')) {
      const tool = body.tool_config as { name: string };
      return Response.json({ id: `tool-${tool.name}` });
    }
    if (url.pathname === '/v1/pronunciation-dictionaries/add-from-rules') {
      return Response.json({ id: 'dictionary-created', version_id: 'version-created' });
    }
    if (url.pathname === '/v1/pronunciation-dictionaries/dictionary-created') {
      return Response.json({ id: 'dictionary-created', latest_version_id: 'version-created', rules: dictionaryRules });
    }
    if (url.pathname === '/v1/pronunciation-dictionaries/dictionary-created/set-rules') {
      return Response.json({ id: 'dictionary-created', version_id: 'version-updated' });
    }
    if (url.pathname.startsWith('/v1/convai/agents/')) return Response.json({ agent_id: 'agent-created' });
    throw new Error(`Unexpected API call: ${call.method} ${call.path}`);
  };
  return { calls, fetchImpl };
}

async function workspace(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'field-guide-voice-agent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'agent.json');
}

test('a new owner gets the secret, seven client tools, dictionary and authenticated agent with reusable ids', async t => {
  const statePath = await workspace(t);
  const api = fakeApi();
  const output: string[] = [];
  await runSync({ env, statePath, fetchImpl: api.fetchImpl, print: text => output.push(text) });
  assert.deepEqual(api.calls.map(call => `${call.method} ${call.path}`), [
    'POST /v1/convai/secrets',
    ...Array(7).fill('POST /v1/convai/tools'),
    'POST /v1/pronunciation-dictionaries/add-from-rules',
    'POST /v1/convai/agents/create',
  ]);
  assert.deepEqual(api.calls[0].body, { type: 'new', name: 'field-guide-agent-llm', value: env.AGENT_LLM_SECRET });
  for (const call of api.calls) {
    assert.equal(call.headers.get('xi-api-key'), env.ELEVENLABS_API_KEY);
    assert.equal(call.headers.get('content-type'), 'application/json');
  }
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.deepEqual(state, {
    agentId: 'agent-created', secretId: 'secret-created',
    toolIds: {
      show_part: 'tool-show_part', start_procedure: 'tool-start_procedure', next_step: 'tool-next_step',
      previous_step: 'tool-previous_step', repeat_step: 'tool-repeat_step',
      go_to_step: 'tool-go_to_step', end_procedure: 'tool-end_procedure',
    },
    dictionary: { id: 'dictionary-created', versionId: 'version-created' },
  });
  const agent = api.calls.at(-1)!.body as {
    conversation_config: { agent: { prompt: { tool_ids: string[]; custom_llm: { api_key: { secret_id: string } } } } };
    platform_settings: { auth: { enable_auth: boolean } };
  };
  assert.deepEqual(agent.conversation_config.agent.prompt.tool_ids, Object.values(state.toolIds));
  assert.equal(agent.conversation_config.agent.prompt.custom_llm.api_key.secret_id, state.secretId);
  assert.equal(agent.platform_settings.auth.enable_auth, true);
  assert.ok(output.join('\n').includes('agent-created'));
  assert.ok(output.join('\n').includes('npx wrangler secret put AGENT_ID'));
});

test('a later sync updates existing resources and replaces changed dictionary rules in a new version', async t => {
  const statePath = await workspace(t);
  const first = fakeApi();
  await runSync({ env, statePath, fetchImpl: first.fetchImpl, print: () => {} });
  const later = fakeApi([{ type: 'alias', string_to_replace: 'Gol', alias: 'wrong' }]);
  await runSync({ env, statePath, fetchImpl: later.fetchImpl, print: () => {} });
  assert.deepEqual(later.calls.map(call => `${call.method} ${call.path}`), [
    'PATCH /v1/convai/secrets/secret-created',
    'PATCH /v1/convai/tools/tool-show_part', 'PATCH /v1/convai/tools/tool-start_procedure',
    'PATCH /v1/convai/tools/tool-next_step', 'PATCH /v1/convai/tools/tool-previous_step',
    'PATCH /v1/convai/tools/tool-repeat_step', 'PATCH /v1/convai/tools/tool-go_to_step',
    'PATCH /v1/convai/tools/tool-end_procedure',
    'GET /v1/pronunciation-dictionaries/dictionary-created',
    'POST /v1/pronunciation-dictionaries/dictionary-created/set-rules',
    'PATCH /v1/convai/agents/agent-created',
  ]);
  assert.equal(later.calls[0].body.type, 'update');
  assert.deepEqual(later.calls.at(-2)!.body, { rules: pronunciationRules });
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.deepEqual(state.dictionary, { id: 'dictionary-created', versionId: 'version-updated' });
});

test('unchanged pronunciation rules keep their version despite API defaults and rule order', async t => {
  const statePath = await workspace(t);
  await runSync({ env, statePath, fetchImpl: fakeApi().fetchImpl, print: () => {} });
  const later = fakeApi([...pronunciationRules].reverse().map(rule => ({
    ...rule, case_sensitive: true, word_boundaries: true,
  })));
  await runSync({ env, statePath, fetchImpl: later.fetchImpl, print: () => {} });
  assert.ok(later.calls.every(call => !call.path.endsWith('/set-rules')));
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')).dictionary, {
    id: 'dictionary-created', versionId: 'version-created',
  });
});

test('an API error stops provisioning with the status and detail while saving ids already created', async t => {
  for (const failureAt of [2, 10]) {
    const statePath = await workspace(t);
    const api = fakeApi();
    let requests = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      requests++;
      if (requests === failureAt) return Response.json({ detail: { message: 'Permission denied' } }, { status: 403 });
      return api.fetchImpl(input, init);
    };
    await assert.rejects(runSync({ env, statePath, fetchImpl, print: () => {} }), /403.*Permission denied/);
    assert.equal(requests, failureAt);
    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(saved.secretId, 'secret-created');
    assert.equal(saved.agentId, undefined);
    if (failureAt === 10) {
      assert.equal(Object.keys(saved.toolIds).length, 7);
      assert.deepEqual(saved.dictionary, { id: 'dictionary-created', versionId: 'version-created' });
    }
  }
});

test('dry runs need no credentials, make no requests, leave state untouched and hide supplied secrets', async t => {
  const statePath = await workspace(t);
  await writeFile(statePath, '{}\n');
  let requests = 0;
  const fetchImpl: typeof fetch = async () => {
    requests++;
    throw new Error('Dry runs must not call the API');
  };
  for (const settings of [env, {}]) {
    const output: string[] = [];
    await runSync({ env: settings, statePath, fetchImpl, dryRun: true, print: text => output.push(text) });
    const text = output.join('\n');
    assert.ok(!text.includes(env.ELEVENLABS_API_KEY));
    assert.ok(!text.includes(env.AGENT_LLM_SECRET));
    const plan = JSON.parse(text);
    assert.equal(plan.secret.value, '<secret>');
    assert.equal(plan.tools.length, 7);
    assert.equal(plan.tools[0].tool_config.name, 'show_part');
    assert.ok(plan.agent.conversation_config.agent.prompt.prompt.includes('Coolant reservoir'));
    assert.equal(plan.agent.conversation_config.tts.voice_id, settings === env ? 'owner-voice' : '<voice id>');
    assert.equal(plan.agent.conversation_config.agent.prompt.custom_llm.url,
      settings === env ? 'https://worker.example/v1/chat/completions' : '<worker url>/v1/chat/completions');
  }
  assert.equal(requests, 0);
  assert.equal(await readFile(statePath, 'utf8'), '{}\n');
});

test('sync rejects missing settings before provisioning any resource', async t => {
  const statePath = await workspace(t);
  const api = fakeApi();
  for (const name of ['ELEVENLABS_API_KEY', 'AGENT_LLM_SECRET', 'WORKER_URL', 'VOICE_ID'] as const) {
    await assert.rejects(runSync({ env: { ...env, [name]: '' }, statePath, fetchImpl: api.fetchImpl }),
      new RegExp(`Missing ${name}`));
  }
  assert.equal(api.calls.length, 0);
});

test('invalid local state stops sync instead of discarding an existing resource reference', async t => {
  const statePath = await workspace(t);
  await writeFile(statePath, JSON.stringify({ toolIds: { show_part: 0 } }));
  const api = fakeApi();
  await assert.rejects(runSync({ env, statePath, fetchImpl: api.fetchImpl }), /Invalid agent.json/);
  assert.equal(api.calls.length, 0);
});
