import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Setting, Placeholder } from '../src/sync.ts';

test('the plan command loads an optional owner environment without exposing its secrets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'field-guide-voice-plan-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packageUrl = new URL('../package.json', import.meta.url);
  const { scripts } = JSON.parse(await readFile(packageUrl, 'utf8'));
  await writeFile(join(directory, '.env'), [
    `${Setting.voiceId}=local-voice`, `${Setting.workerUrl}=https://owner.example`,
    `${Setting.apiKey}=private-api-key`, `${Setting.llmSecret}=private-llm-secret`,
  ].join('\n'));
  const cli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
  const source = fileURLToPath(new URL('../src/sync.ts', import.meta.url));
  const fakeFetch = join(directory, 'fake-fetch.mjs');
  await writeFile(fakeFetch, "globalThis.fetch = async () => { throw new Error('Plans must not request the API'); };\n");
  const args = scripts.plan.split(' ').slice(1).map((arg: string) => arg === 'src/sync.ts' ? source : arg);
  const env = { ...process.env };
  for (const key of Object.values(Setting)) delete env[key];
  for (const withEnv of [true, false]) {
    if (!withEnv) await rm(join(directory, '.env'));
    const result = spawnSync(process.execPath, ['--import', fakeFetch, cli, ...args], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.agent.conversation_config.tts.voice_id, withEnv ? 'local-voice' : Placeholder.voiceId);
    assert.ok(!result.stdout.includes('private-api-key'));
    assert.ok(!result.stdout.includes('private-llm-secret'));
  }
});
