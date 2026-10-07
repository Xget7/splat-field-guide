import { readFile, writeFile, rename, rm } from 'node:fs/promises';

export const JSON_INDENT = 2;
export const PRIVATE_FILE_MODE = 0o600;
export const INVALID_STATE = 'Invalid agent.json. Keep saved ids as nonempty strings and dictionary as { id, versionId }.';

export interface DictionaryRef {
  id: string;
  versionId: string;
}

export interface AgentState {
  agentId?: string;
  secretId?: string;
  toolIds?: Record<string, string>;
  dictionary?: DictionaryRef;
}

export async function loadState(path: string): Promise<AgentState> {
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

export async function saveState(path: string, state: AgentState): Promise<void> {
  const temporaryPath = path + '.tmp';
  try {
    await writeFile(temporaryPath, JSON.stringify(state, null, JSON_INDENT) + '\n', { mode: PRIVATE_FILE_MODE });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
