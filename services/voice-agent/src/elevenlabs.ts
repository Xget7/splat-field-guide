import type { ClientToolConfig } from './tools.ts';
import type { PronunciationRule } from './pronunciation.ts';
import type { buildAgentConfig } from './agentConfig.ts';
import type { DictionaryRef } from './state.ts';

export const API_URL = 'https://api.elevenlabs.io/v1';
export const API_KEY_HEADER = 'xi-api-key';
export const CONTENT_TYPE_HEADER = 'content-type';
export const JSON_CONTENT_TYPE = 'application/json';
export const SECRET_PATH = '/convai/secrets';
export const TOOL_PATH = '/convai/tools';
export const DICTIONARY_PATH = '/pronunciation-dictionaries';
export const CREATE_AGENT_PATH = '/convai/agents/create';
export const AGENT_PATH = '/convai/agents';
export const SECRET_NAME = 'field-guide-agent-llm';
export const Method = { get: 'GET', create: 'POST', update: 'PATCH' } as const;
export const SecretType = { create: 'new', update: 'update' } as const;
export const CREATE_DICTIONARY_PATH = DICTIONARY_PATH + '/add-from-rules';
export const SET_RULES_PATH = '/set-rules';
const INVALID_JSON = 'Invalid JSON response';
const INVALID_RESPONSE = 'Invalid ElevenLabs response';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(INVALID_RESPONSE);
  return value as Record<string, unknown>;
}

function resourceId(value: unknown, field: string): string {
  const id = record(value)[field];
  if (typeof id !== 'string' || !id.trim()) throw new Error(INVALID_RESPONSE);
  return id;
}

interface DictionaryResponse { id: string; version_id: string }

export function createElevenLabs(apiKey: string, fetchImpl: typeof fetch) {
  async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const response = await fetchImpl(API_URL + path, {
      method,
      headers: { [API_KEY_HEADER]: apiKey, [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let value: unknown;
    try { value = JSON.parse(text); } catch { value = null; }
    if (!response.ok) {
      const detail = value !== null && typeof value === 'object' && 'detail' in value ? value.detail : text;
      throw new Error(`ElevenLabs ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    }
    if (value === null) throw new Error(`ElevenLabs ${response.status}: ${INVALID_JSON}`);
    return value as T;
  }
  function createOrUpdate<T>(path: string, body: unknown, id?: string, createPath = path): Promise<T> {
    return request<T>(
      id ? `${path}/${encodeURIComponent(id)}` : createPath,
      id ? Method.update : Method.create,
      body,
    );
  }

  function dictionaryRef(response: DictionaryResponse): DictionaryRef {
    return { id: resourceId(response, 'id'), versionId: resourceId(response, 'version_id') };
  }

  return {
    secret: async (value: string, id?: string) => ({ secret_id: resourceId(await createOrUpdate<unknown>(
      SECRET_PATH, { type: id ? SecretType.update : SecretType.create, name: SECRET_NAME, value }, id,
    ), 'secret_id') }),
    tool: async (config: ClientToolConfig, id?: string) => ({ id: resourceId(await createOrUpdate<unknown>(
      TOOL_PATH, { tool_config: config }, id,
    ), 'id') }),
    createDictionaryRef: async (name: string, rules: readonly PronunciationRule[]) => dictionaryRef(
      await request<DictionaryResponse>(CREATE_DICTIONARY_PATH, Method.create, { name, rules }),
    ),
    getDictionaryVersion: async (id: string): Promise<DictionaryRef & { rules: readonly PronunciationRule[] }> => {
      const response = await request<{ latest_version_id: string; rules: readonly PronunciationRule[] }>(
        `${DICTIONARY_PATH}/${encodeURIComponent(id)}`, Method.get,
      );
      const versionId = resourceId(response, 'latest_version_id');
      if (!Array.isArray(response.rules) || !response.rules.every(rule =>
        rule && typeof rule.type === 'string' && typeof rule.string_to_replace === 'string' &&
          (rule.alias === undefined || typeof rule.alias === 'string') &&
          (rule.case_sensitive === undefined || typeof rule.case_sensitive === 'boolean') &&
          (rule.word_boundaries === undefined || typeof rule.word_boundaries === 'boolean'),
      )) throw new Error(INVALID_RESPONSE);
      return { id, versionId, rules: response.rules };
    },
    updateDictionaryRef: async (id: string, rules: readonly PronunciationRule[]) => dictionaryRef(
      await request<DictionaryResponse>(
        `${DICTIONARY_PATH}/${encodeURIComponent(id)}${SET_RULES_PATH}`, Method.create, { rules },
      ),
    ),
    agent: async (config: ReturnType<typeof buildAgentConfig>, id?: string) => ({ agent_id: resourceId(await createOrUpdate<unknown>(
      AGENT_PATH, config, id, CREATE_AGENT_PATH,
    ), 'agent_id') }),
  };
}
