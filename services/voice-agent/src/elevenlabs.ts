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
    return { id: response.id, versionId: response.version_id };
  }

  return {
    secret: (value: string, id?: string) => createOrUpdate<{ secret_id: string }>(
      SECRET_PATH, { type: id ? SecretType.update : SecretType.create, name: SECRET_NAME, value }, id,
    ),
    tool: (config: ClientToolConfig, id?: string) => createOrUpdate<{ id: string }>(
      TOOL_PATH, { tool_config: config }, id,
    ),
    createDictionaryRef: async (name: string, rules: readonly PronunciationRule[]) => dictionaryRef(
      await request<DictionaryResponse>(CREATE_DICTIONARY_PATH, Method.create, { name, rules }),
    ),
    getDictionaryVersion: async (id: string): Promise<DictionaryRef & { rules: readonly PronunciationRule[] }> => {
      const response = await request<{ latest_version_id: string; rules: readonly PronunciationRule[] }>(
        `${DICTIONARY_PATH}/${encodeURIComponent(id)}`, Method.get,
      );
      return { id, versionId: response.latest_version_id, rules: response.rules };
    },
    updateDictionaryRef: async (id: string, rules: readonly PronunciationRule[]) => dictionaryRef(
      await request<DictionaryResponse>(
        `${DICTIONARY_PATH}/${encodeURIComponent(id)}${SET_RULES_PATH}`, Method.create, { rules },
      ),
    ),
    agent: (config: ReturnType<typeof buildAgentConfig>, id?: string) => createOrUpdate<{ agent_id: string }>(
      AGENT_PATH, config, id, CREATE_AGENT_PATH,
    ),
  };
}
