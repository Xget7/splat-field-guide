import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parsePack } from '../../../apps/field-guide/src/features/pack/parsePack.ts';
import { buildAgentConfig } from './agentConfig.ts';
import { buildToolConfigs } from './tools.ts';
import { pronunciationRules, type PronunciationRule } from './pronunciation.ts';
import { createElevenLabs, SECRET_NAME, SecretType } from './elevenlabs.ts';
import { loadState, saveState, JSON_INDENT, type AgentState } from './state.ts';

const MANIFEST_URL = new URL('../../../content/gol-trend-engine-bay/manifest.json', import.meta.url);
const STATE_PATH = fileURLToPath(new URL('../agent.json', import.meta.url));
export const WORKER_COMMAND = 'npx wrangler secret put AGENT_ID';
export const DICTIONARY_NAME = 'Field Guide terms';
export const DRY_RUN_ARGUMENT = '--dry-run';
export const Placeholder = {
  secret: '<secret>', secretId: '<secret id>', voiceId: '<voice id>', workerUrl: '<worker url>',
  dictionaryId: '<dictionary id>', dictionaryVersion: '<dictionary version id>',
} as const;
export const Setting = {
  apiKey: 'ELEVENLABS_API_KEY', llmSecret: 'AGENT_LLM_SECRET', workerUrl: 'WORKER_URL', voiceId: 'VOICE_ID',
} as const;
type Setting = (typeof Setting)[keyof typeof Setting];
type Environment = Partial<Record<Setting, string>>;
const SyncCopy = {
  missingSetting: (name: Setting) => `Missing ${name}. Set it in services/voice-agent/.env.`,
  completed: (id: string) =>
    `Agent id: ${id}\nFrom services/instructor-proxy, run ${WORKER_COMMAND} and paste this id.`,
} as const;
export interface SyncOptions {
  readonly env?: Environment;
  readonly statePath?: string;
  readonly fetchImpl?: typeof fetch;
  readonly print?: (text: string) => void;
  readonly dryRun?: boolean;
}

function readSetting(env: Environment, name: Setting, dryRun: boolean): string {
  if (dryRun) {
    if (name === Setting.apiKey || name === Setting.llmSecret) return Placeholder.secret;
    return env[name]?.trim() || (name === Setting.workerUrl ? Placeholder.workerUrl : Placeholder.voiceId);
  }
  const value = env[name]?.trim();
  if (!value) throw new Error(SyncCopy.missingSetting(name));
  return value;
}

function ruleKey(rules: readonly PronunciationRule[]): string {
  return JSON.stringify(rules.map(rule => JSON.stringify([
    rule.type, rule.string_to_replace, rule.alias,
    rule.case_sensitive ?? true, rule.word_boundaries ?? true,
  ])).sort());
}

export async function runSync(options: SyncOptions = {}): Promise<AgentState> {
  const env = options.env ?? process.env;
  const dryRun = options.dryRun ?? false;
  const apiKey = readSetting(env, Setting.apiKey, dryRun);
  const llmSecret = readSetting(env, Setting.llmSecret, dryRun);
  const workerUrl = readSetting(env, Setting.workerUrl, dryRun);
  const voiceId = readSetting(env, Setting.voiceId, dryRun);
  const parsed = parsePack(JSON.parse(await readFile(MANIFEST_URL, 'utf8')));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const pack = parsed.pack;
  const statePath = options.statePath ?? STATE_PATH;
  const state = await loadState(statePath);
  const tools = buildToolConfigs(pack);
  if (dryRun) {
    const plan = {
      secret: { type: state.secretId ? SecretType.update : SecretType.create, name: SECRET_NAME, value: Placeholder.secret },
      tools: tools.map(tool => ({ tool_config: tool })),
      dictionary: { name: DICTIONARY_NAME, rules: pronunciationRules },
      agent: buildAgentConfig(pack, {
        workerUrl, voiceId, secretId: state.secretId ?? Placeholder.secretId,
        toolIds: tools.map(tool => state.toolIds?.[tool.name] ?? `<tool id: ${tool.name}>`),
        dictionary: state.dictionary ?? { id: Placeholder.dictionaryId, versionId: Placeholder.dictionaryVersion },
      }),
    };
    (options.print ?? console.log)(JSON.stringify(plan, null, JSON_INDENT));
    return state;
  }
  const api = createElevenLabs(apiKey, options.fetchImpl ?? fetch);
  const secret = await api.secret(llmSecret, state.secretId);
  state.secretId = secret.secret_id;
  await saveState(statePath, state);
  const toolIds = state.toolIds ??= {};
  for (const tool of tools) {
    const result = await api.tool(tool, toolIds[tool.name]);
    toolIds[tool.name] = result.id;
    await saveState(statePath, state);
  }
  if (state.dictionary) {
    const current = await api.getDictionaryVersion(state.dictionary.id);
    if (ruleKey(current.rules) === ruleKey(pronunciationRules)) {
      state.dictionary.versionId = current.versionId;
    } else {
      state.dictionary = await api.updateDictionaryRef(state.dictionary.id, pronunciationRules);
    }
  } else {
    state.dictionary = await api.createDictionaryRef(DICTIONARY_NAME, pronunciationRules);
  }
  await saveState(statePath, state);
  const agent = await api.agent(buildAgentConfig(pack, {
    workerUrl, voiceId, secretId: state.secretId, toolIds: tools.map(tool => toolIds[tool.name]), dictionary: state.dictionary,
  }), state.agentId);
  state.agentId = agent.agent_id;
  await saveState(statePath, state);
  (options.print ?? console.log)(SyncCopy.completed(state.agentId));
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await runSync({ dryRun: process.argv.includes(DRY_RUN_ARGUMENT) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
