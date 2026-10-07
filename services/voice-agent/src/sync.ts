import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parsePack } from '../../../apps/field-guide/src/features/pack/parsePack.ts';
import { buildAgentConfig } from './agentConfig.ts';
import { buildToolConfigs } from './tools.ts';
import { pronunciationRules } from './pronunciation.ts';
import { createElevenLabs, type DictionaryRule } from './elevenlabs.ts';

const MANIFEST_URL = new URL('../../../content/gol-trend-engine-bay/manifest.json', import.meta.url);
const STATE_PATH = fileURLToPath(new URL('../agent.json', import.meta.url));
const JSON_INDENT = 2;
const PRIVATE_FILE_MODE = 0o600;
const WORKER_COMMAND = 'npx wrangler secret put AGENT_ID';
const DICTIONARY_NAME = 'Field Guide terms';
const INVALID_STATE = 'Invalid agent.json. Keep saved ids as nonempty strings and dictionary as { id, versionId }.';
const SECRET_NAME = 'field-guide-agent-llm';
const DRY_RUN_ARGUMENT = '--dry-run';
const Placeholder = {
  secret: '<secret>', secretId: '<secret id>', voiceId: '<voice id>', workerUrl: '<worker url>',
  dictionaryId: '<dictionary id>', dictionaryVersion: '<dictionary version id>',
} as const;
const Setting = {
  apiKey: 'ELEVENLABS_API_KEY', llmSecret: 'AGENT_LLM_SECRET', workerUrl: 'WORKER_URL', voiceId: 'VOICE_ID',
} as const;
type Setting = (typeof Setting)[keyof typeof Setting];
type Environment = Partial<Record<Setting, string>>;
const SyncCopy = {
  missingSetting: (name: Setting) => `Missing ${name}. Set it in services/voice-agent/.env.`,
  completed: (id: string) =>
    `Agent id: ${id}\nFrom services/instructor-proxy, run ${WORKER_COMMAND} and paste this id.`,
} as const;
export interface AgentState {
  agentId?: string;
  secretId?: string;
  toolIds?: Record<string, string>;
  dictionary?: { id: string; versionId: string };
}
export interface SyncOptions {
  readonly env?: Environment;
  readonly statePath?: string;
  readonly fetchImpl?: typeof fetch;
  readonly print?: (text: string) => void;
  readonly dryRun?: boolean;
}

function required(env: Environment, name: Setting): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(SyncCopy.missingSetting(name));
  return value;
}

async function loadState(path: string): Promise<AgentState> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    if (error instanceof SyntaxError) throw new Error(INVALID_STATE);
    throw error;
  }
  if (!isObject(value) ||
      (value.agentId !== undefined && !isId(value.agentId)) ||
      (value.secretId !== undefined && !isId(value.secretId)) ||
      (value.toolIds !== undefined && (!isObject(value.toolIds) || !Object.values(value.toolIds).every(isId))) ||
      (value.dictionary !== undefined && (!isObject(value.dictionary) ||
        !isId(value.dictionary.id) || !isId(value.dictionary.versionId)))) {
    throw new Error(INVALID_STATE);
  }
  return value as AgentState;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function ruleIdentity(rules: readonly DictionaryRule[]): string {
  return JSON.stringify(rules.map(rule => JSON.stringify([
    rule.type, rule.string_to_replace, rule.alias,
    rule.case_sensitive ?? true, rule.word_boundaries ?? true,
  ])).sort());
}

export async function runSync(options: SyncOptions = {}): Promise<AgentState> {
  const env = options.env ?? process.env;
  const dryRun = options.dryRun ?? false;
  const apiKey = dryRun ? '' : required(env, Setting.apiKey);
  const llmSecret = dryRun ? Placeholder.secret : required(env, Setting.llmSecret);
  const workerUrl = dryRun ? env.WORKER_URL?.trim() || Placeholder.workerUrl : required(env, Setting.workerUrl);
  const voiceId = dryRun ? env.VOICE_ID?.trim() || Placeholder.voiceId : required(env, Setting.voiceId);
  const parsed = parsePack(JSON.parse(await readFile(MANIFEST_URL, 'utf8')));
  if (!parsed.ok) throw new Error(parsed.error.message);
  const pack = parsed.pack;
  const statePath = options.statePath ?? STATE_PATH;
  const state = await loadState(statePath);
  const tools = buildToolConfigs(pack);
  if (dryRun) {
    const plan = {
      secret: { type: state.secretId ? 'update' : 'new', name: SECRET_NAME, value: Placeholder.secret },
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
  async function save() {
    const temporaryPath = statePath + '.tmp';
    try {
      await writeFile(temporaryPath, JSON.stringify(state, null, JSON_INDENT) + '\n', { mode: PRIVATE_FILE_MODE });
      await rename(temporaryPath, statePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
  const api = createElevenLabs(apiKey, options.fetchImpl ?? fetch);
  const secret = await api.secret(llmSecret, state.secretId);
  state.secretId = secret.secret_id;
  await save();
  state.toolIds ??= {};
  for (const tool of tools) {
    const result = await api.tool(tool, state.toolIds[tool.name]);
    state.toolIds[tool.name] = result.id;
    await save();
  }
  if (state.dictionary) {
    const current = await api.dictionaryRules(state.dictionary.id);
    if (ruleIdentity(current.rules) === ruleIdentity(pronunciationRules)) {
      state.dictionary.versionId = current.latest_version_id;
    } else {
      const updated = await api.setDictionaryRules(state.dictionary.id, pronunciationRules);
      state.dictionary = { id: updated.id, versionId: updated.version_id };
    }
  } else {
    const dictionary = await api.dictionary(DICTIONARY_NAME, pronunciationRules);
    state.dictionary = { id: dictionary.id, versionId: dictionary.version_id };
  }
  await save();
  const agent = await api.agent(buildAgentConfig(pack, {
    workerUrl, voiceId, secretId: state.secretId, toolIds: Object.values(state.toolIds), dictionary: state.dictionary,
  }), state.agentId);
  state.agentId = agent.agent_id;
  await save();
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
