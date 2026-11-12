import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openManualIndex, type ManualIndex } from '../../../apps/field-guide/src/features/semantic/index.ts';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parsePack } from '../../../apps/field-guide/src/features/pack/parsePack.ts';
import { buildAgentConfig } from './agentConfig.ts';
import { knowledgeDocuments } from './knowledge.ts';
import { buildToolConfigs } from './tools.ts';
import { pronunciationRules, type PronunciationRule } from './pronunciation.ts';
import { createElevenLabs } from './elevenlabs.ts';
import { loadState, saveState, JSON_INDENT, type AgentState } from './state.ts';

const STATE_PATH = fileURLToPath(new URL('../agent.json', import.meta.url));
export const WORKER_COMMAND = 'pnpm exec wrangler secret put AGENT_ID';
export const DICTIONARY_NAME = 'Field Guide terms';
export const DRY_RUN_ARGUMENT = '--dry-run';
export const Placeholder = {
  secret: '<secret>', secretId: '<secret id>', voiceId: '<voice id>', workerUrl: '<worker url>',
  dictionaryId: '<dictionary id>', dictionaryVersion: '<dictionary version id>',
} as const;
export const Setting = {
  apiKey: 'ELEVENLABS_API_KEY', voiceId: 'VOICE_ID',
} as const;
type Setting = (typeof Setting)[keyof typeof Setting];
type Environment = Partial<Record<Setting, string>>;
const SyncCopy = {
  missingSetting: (name: Setting) => `Missing ${name}. Set it in services/voice-agent/.env.`,
  completed: (id: string) =>
    `Agent id: ${id}\nFrom services/instructor-proxy, run ${WORKER_COMMAND} and paste this id.`,
} as const;
export interface SyncOptions {
  readonly manifest?: unknown;
  readonly manuals?: ManualIndex;
  readonly hostManuals?: boolean;
  readonly env?: Environment;
  readonly statePath?: string;
  readonly fetchImpl?: typeof fetch;
  readonly print?: (text: string) => void;
  readonly dryRun?: boolean;
}

function readSetting(env: Environment, name: Setting, dryRun: boolean): string {
  if (dryRun) {
    if (name === Setting.apiKey) return Placeholder.secret;
    return env[name]?.trim() || Placeholder.voiceId;
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
  const voiceId = readSetting(env, Setting.voiceId, dryRun);
  if (options.manifest === undefined) throw new Error('An explicit validated manifest is required');
  const parsed = parsePack(options.manifest);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const pack = parsed.pack;
  const statePath = options.statePath ?? STATE_PATH;
  const state = await loadState(statePath);
  if (state.manualSources?.length && !options.manuals) throw new Error('This agent includes complete manuals. Pass --manual-index <directory> to preserve that knowledge scope.');
  const tools = buildToolConfigs(pack);
  const documents = knowledgeDocuments(pack, options.hostManuals ? options.manuals : undefined);
  if (dryRun) {
    const plan = {
      knowledge: documents,
      tools: tools.map(tool => ({ tool_config: tool })),
      dictionary: { name: DICTIONARY_NAME, rules: pronunciationRules },
      agent: buildAgentConfig(pack, {
        voiceId, knowledgeIds: documents.map(document => ({ id: state.knowledge?.[document.digest]?.id ?? `<knowledge id: ${document.key}>`, name: document.name })),
        toolIds: tools.map(tool => state.toolIds?.[tool.name] ?? `<tool id: ${tool.name}>`),
        manualSources: options.manuals?.documents.map(document => ({ id: document.id, edition: document.edition, sha256: document.sha256 })),
        dictionary: state.dictionary ?? { id: Placeholder.dictionaryId, versionId: Placeholder.dictionaryVersion },
      }),
    };
    (options.print ?? console.log)(JSON.stringify(plan, null, JSON_INDENT));
    return state;
  }
  const api = createElevenLabs(apiKey, options.fetchImpl ?? fetch);
  const knowledge = state.knowledge ??= {};
  if (options.hostManuals) {
    const usage = await api.ragUsage();
    const required = documents.filter(document => !knowledge[document.digest]).reduce((sum, document) => sum + Buffer.byteLength(document.text), 0);
    const desiredBytes = documents.reduce((sum, document) => sum + Buffer.byteLength(document.text), 0);
    if (desiredBytes > usage.total_max_bytes || required > usage.total_max_bytes - usage.total_used_bytes) throw new Error(`Insufficient hosted RAG capacity: ${required} new bytes required, ${usage.total_max_bytes - usage.total_used_bytes} available. Complete manuals remain available through the app client tools without hosted manual indexing.`);
  }
  const knowledgeIds: { id: string; name: string }[] = [];
  for (const document of documents) {
    let saved = knowledge[document.digest];
    if (!saved) {
      const uploaded = await api.knowledge(document.name, document.text);
      saved = { ...uploaded, digest: document.digest };
      knowledge[document.digest] = saved;
      await saveState(statePath, state);
    }
    knowledgeIds.push(saved);
  }
  const pending: string[] = [];
  for (const document of knowledgeIds) {
    const status = await api.indexKnowledge(document.id);
    if (status !== 'succeeded') pending.push(`${document.name}: ${status}`);
  }
  if (pending.length) throw new Error(`Knowledge is not ready; the existing agent was preserved. Retry sync after indexing completes.\n${pending.join('\n')}`);
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
  if (options.manuals) state.manualSources = options.manuals.documents.map(document => ({ id: document.id, sha256: document.sha256 }));
  const agent = await api.agent(buildAgentConfig(pack, {
    voiceId, knowledgeIds, toolIds: tools.map(tool => toolIds[tool.name]), dictionary: state.dictionary,
    manualSources: options.manuals?.documents.map(document => ({ id: document.id, edition: document.edition, sha256: document.sha256 })),
  }), state.agentId);
  state.agentId = agent.agent_id;
  await saveState(statePath, state);
  (options.print ?? console.log)(SyncCopy.completed(state.agentId));
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const manifestIndex = process.argv.indexOf('--manifest');
    if (manifestIndex < 0 || !process.argv[manifestIndex + 1]) throw new Error('Pass --manifest <file>');
    const manifest = JSON.parse(await readFile(process.argv[manifestIndex + 1], 'utf8'));
    const manualArg = process.argv.indexOf('--manual-index');
    const directory = manualArg >= 0 ? process.argv[manualArg + 1] : process.env.FIELD_GUIDE_MANUAL_INDEX_DIR;
    let manuals: ManualIndex | undefined;
    if (directory) {
      const receipt = JSON.parse(await readFile(resolve(directory, 'receipt.json'), 'utf8'));
      if (receipt.schemaVersion !== 1 || receipt.index?.path !== 'manuals.json') throw new Error('Invalid manual receipt');
      const bytes = await readFile(resolve(directory, 'manuals.json'));
      if (bytes.length !== receipt.index.bytes || createHash('sha256').update(bytes).digest('hex') !== receipt.index.sha256) throw new Error('Prepared manual index digest mismatch');
      const catalog = JSON.parse(await readFile(new URL('../../../apps/field-guide/assets/documents/catalog.json', import.meta.url), 'utf8'));
      manuals = openManualIndex(JSON.parse(bytes.toString('utf8')), catalog);
    }
    const stateArg = process.argv.indexOf('--state');
    const statePath = stateArg >= 0 ? process.argv[stateArg + 1] : undefined;
    if (stateArg >= 0 && !statePath) throw new Error('Pass --state <file>');
    await runSync({ manifest, manuals, statePath, hostManuals: process.argv.includes('--host-manuals'), dryRun: process.argv.includes(DRY_RUN_ARGUMENT) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
