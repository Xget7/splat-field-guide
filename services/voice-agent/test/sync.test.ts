import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync, Setting, Placeholder, WORKER_COMMAND } from '../src/sync.ts';
import { pronunciationRules, ALIAS_RULE_TYPE } from '../src/pronunciation.ts';
import {
  API_URL, SECRET_PATH, TOOL_PATH, DICTIONARY_PATH, CREATE_DICTIONARY_PATH, SET_RULES_PATH,
  AGENT_PATH, CREATE_AGENT_PATH, API_KEY_HEADER, CONTENT_TYPE_HEADER, JSON_CONTENT_TYPE,
  SECRET_NAME, SecretType, Method,
} from '../src/elevenlabs.ts';
import { INVALID_STATE } from '../src/state.ts';
import { LLM_BASE_PATH, type buildAgentConfig } from '../src/agentConfig.ts';
import { buildToolConfigs } from '../src/tools.ts';
import { pack } from './pack.ts';

const tools = buildToolConfigs(pack);
const apiPath = (path: string) => new URL(API_URL + path).pathname;
const env = {
  [Setting.apiKey]: 'test-api-key', [Setting.llmSecret]: 'test-llm-secret',
  [Setting.workerUrl]: 'https://worker.example', [Setting.voiceId]: 'owner-voice',
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
    assert.equal(url.origin, new URL(API_URL).origin);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const call = { method: init?.method ?? Method.get, path: url.pathname, headers: new Headers(init?.headers), body };
    calls.push(call);
    if (url.pathname.startsWith(apiPath(SECRET_PATH))) return Response.json({ secret_id: 'secret-created' });
    if (url.pathname.startsWith(apiPath(TOOL_PATH))) {
      const tool = body.tool_config as { name: string };
      return Response.json({ id: `tool-${tool.name}` });
    }
    if (url.pathname === apiPath(CREATE_DICTIONARY_PATH)) {
      return Response.json({ id: 'dictionary-created', version_id: 'version-created' });
    }
    if (url.pathname === apiPath(DICTIONARY_PATH + '/dictionary-created')) {
      return Response.json({ id: 'dictionary-created', latest_version_id: 'version-created', rules: dictionaryRules });
    }
    if (url.pathname === apiPath(DICTIONARY_PATH + '/dictionary-created' + SET_RULES_PATH)) {
      return Response.json({ id: 'dictionary-created', version_id: 'version-updated' });
    }
    if (url.pathname.startsWith(apiPath(AGENT_PATH))) return Response.json({ agent_id: 'agent-created' });
    throw new Error(`Unexpected API call: ${call.method} ${call.path}`);
  };
  return { calls, fetchImpl };
}

async function workspace(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'field-guide-voice-agent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'agent.json');
}

test('first sync creates resources and later sync reuses them in current tool order without a new dictionary version', async t => {
  const statePath = await workspace(t);
  const first = fakeApi();
  const output: string[] = [];
  const state = await runSync({ env, statePath, fetchImpl: first.fetchImpl, print: text => output.push(text) });
  assert.deepEqual(first.calls.map(call => [call.method, call.path]), [
    [Method.create, apiPath(SECRET_PATH)],
    ...tools.map(() => [Method.create, apiPath(TOOL_PATH)]),
    [Method.create, apiPath(CREATE_DICTIONARY_PATH)],
    [Method.create, apiPath(CREATE_AGENT_PATH)],
  ]);
  assert.deepEqual(first.calls[0].body, {
    type: SecretType.create, name: SECRET_NAME, value: env[Setting.llmSecret],
  });
  for (const call of first.calls) {
    assert.equal(call.headers.get(API_KEY_HEADER), env[Setting.apiKey]);
    assert.equal(call.headers.get(CONTENT_TYPE_HEADER), JSON_CONTENT_TYPE);
  }
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), state);
  assert.ok(output.join('\n').includes(state.agentId!));
  assert.ok(output.join('\n').includes(WORKER_COMMAND));
  const currentIds = tools.map(tool => state.toolIds![tool.name]);
  state.toolIds = { obsolete_tool: 'stale-tool-id', ...Object.fromEntries(Object.entries(state.toolIds!).reverse()) };
  await writeFile(statePath, JSON.stringify(state));
  const later = fakeApi([...pronunciationRules].reverse().map(rule => ({
    ...rule, case_sensitive: true, word_boundaries: true,
  })));
  const updated = await runSync({ env, statePath, fetchImpl: later.fetchImpl, print: () => {} });
  assert.deepEqual(later.calls.map(call => [call.method, call.path]), [
    [Method.update, apiPath(`${SECRET_PATH}/${state.secretId}`)],
    ...tools.map(tool => [Method.update, apiPath(`${TOOL_PATH}/${state.toolIds![tool.name]}`)]),
    [Method.get, apiPath(`${DICTIONARY_PATH}/${state.dictionary!.id}`)],
    [Method.update, apiPath(`${AGENT_PATH}/${state.agentId}`)],
  ]);
  assert.equal(later.calls[0].body.type, SecretType.update);
  assert.deepEqual(updated.dictionary, state.dictionary);
  for (const api of [first, later]) {
    const agent = api.calls.at(-1)!.body as ReturnType<typeof buildAgentConfig>;
    assert.deepEqual(agent.conversation_config.agent.prompt.tool_ids, currentIds);
    assert.equal(agent.conversation_config.agent.prompt.custom_llm.api_key.secret_id, state.secretId);
    assert.equal(agent.conversation_config.tts.voice_id, env[Setting.voiceId]);
    assert.ok(!JSON.stringify(agent).includes(env[Setting.llmSecret]));
    assert.ok(!JSON.stringify(agent).includes(env[Setting.apiKey]));
  }
});

test('a later sync updates existing resources and replaces changed dictionary rules in a new version', async t => {
  const statePath = await workspace(t);
  const first = fakeApi();
  await runSync({ env, statePath, fetchImpl: first.fetchImpl, print: () => {} });
  const later = fakeApi([{ ...pronunciationRules[0], type: ALIAS_RULE_TYPE, alias: 'wrong' }]);
  await runSync({ env, statePath, fetchImpl: later.fetchImpl, print: () => {} });
  assert.equal(later.calls.at(-2)!.path, apiPath(`${DICTIONARY_PATH}/dictionary-created${SET_RULES_PATH}`));
  assert.equal(later.calls.at(-2)!.method, Method.create);
  assert.deepEqual(later.calls.at(-2)!.body, { rules: pronunciationRules });
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.deepEqual(state.dictionary, { id: 'dictionary-created', versionId: 'version-updated' });
});

test('an API error stops provisioning with the status and detail while saving ids already created', async t => {
  for (const failureAt of [2, tools.length + 3]) {
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
    if (failureAt === tools.length + 3) {
      assert.equal(Object.keys(saved.toolIds).length, tools.length);
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
    assert.ok(!text.includes(env[Setting.apiKey]));
    assert.ok(!text.includes(env[Setting.llmSecret]));
    const plan = JSON.parse(text);
    assert.equal(plan.secret.value, Placeholder.secret);
    assert.equal(plan.tools.length, tools.length);
    assert.equal(plan.agent.conversation_config.tts.voice_id, settings === env ? env[Setting.voiceId] : Placeholder.voiceId);
    assert.equal(plan.agent.conversation_config.agent.prompt.custom_llm.url,
      (settings === env ? env[Setting.workerUrl] : Placeholder.workerUrl) + LLM_BASE_PATH);
    assert.equal(await readFile(statePath, 'utf8'), '{}\n');
  }
  await rm(statePath);
  await runSync({ env: {}, statePath, fetchImpl, dryRun: true, print: () => {} });
  await assert.rejects(readFile(statePath), { code: 'ENOENT' });
  assert.equal(requests, 0);
});

test('sync rejects missing settings before provisioning any resource', async t => {
  const statePath = await workspace(t);
  const api = fakeApi();
  for (const name of Object.values(Setting)) {
    await assert.rejects(runSync({ env: { ...env, [name]: '' }, statePath, fetchImpl: api.fetchImpl }),
      new RegExp(`Missing ${name}`));
  }
  assert.equal(api.calls.length, 0);
});

test('invalid local state stops sync instead of discarding an existing resource reference', async t => {
  const statePath = await workspace(t);
  await writeFile(statePath, JSON.stringify({ toolIds: { [tools[0].name]: 0 } }));
  const api = fakeApi();
  await assert.rejects(runSync({ env, statePath, fetchImpl: api.fetchImpl }), new Error(INVALID_STATE));
  assert.equal(api.calls.length, 0);
});
