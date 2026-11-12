import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../src/sync.ts';
import { pronunciationRules } from '../src/pronunciation.ts';
import { pack, manifest } from './pack.ts';
import { knowledgeDocuments } from '../src/knowledge.ts';

test('sync saves uploaded ids before indexing, preserves the active agent while pending, and reuses documents on retry', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'miris-agent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = join(directory, 'agent.json');
  let indexed = false;
  let documentCount = 0;
  let updates = 0;
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith('/knowledge-base/text')) return Response.json({ id: `document-${++documentCount}` });
    if (path.endsWith('/rag-index')) return Response.json({ status: indexed ? 'succeeded' : 'processing' });
    if (path.includes('/tools')) return Response.json({ id: `tool-${body.tool_config.name}` });
    if (path.endsWith('/add-from-rules')) return Response.json({ id: 'dictionary', version_id: 'v1' });
    if (path.endsWith('/pronunciation-dictionaries/dictionary')) return Response.json({ latest_version_id: 'v1', rules: pronunciationRules });
    if (path.includes('/agents')) { updates++; return Response.json({ agent_id: 'miris-agent' }); }
    throw new Error(`Unexpected path: ${path}`);
  };
  const options = { manifest, statePath, env: { ELEVENLABS_API_KEY: 'fake-key', VOICE_ID: 'voice' }, fetchImpl, print: () => {} };
  await assert.rejects(runSync(options), /existing agent was preserved/);
  assert.equal(updates, 0);
  const count = knowledgeDocuments(pack).length;
  assert.equal(documentCount, count);
  assert.equal(Object.keys(JSON.parse(await readFile(statePath, 'utf8')).knowledge).length, count);
  indexed = true;
  await runSync(options);
  await runSync(options);
  assert.equal(documentCount, count);
  assert.equal(updates, 2);
  assert.ok(calls.every(path => !path.includes('secrets')));
});

test('dry plan exposes prepared documents and configuration without provider requests or secrets', async () => {
  let plan = '';
  await runSync({ manifest, dryRun: true, statePath: '/tmp/no-miris-state-present.json', env: { ELEVENLABS_API_KEY: 'private-key' }, fetchImpl: async () => assert.fail('plan called provider'), print: text => { plan = text; } });
  assert.ok(!plan.includes('private-key'));
  assert.equal(JSON.parse(plan).knowledge.length, knowledgeDocuments(pack).length);
});
