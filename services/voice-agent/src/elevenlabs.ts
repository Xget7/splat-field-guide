import type { ClientToolConfig } from './tools.ts';
import type { PronunciationRule } from './pronunciation.ts';
import type { buildAgentConfig } from './agentConfig.ts';

const API_URL = 'https://api.elevenlabs.io/v1';
const API_KEY_HEADER = 'xi-api-key';
const CONTENT_TYPE_HEADER = 'content-type';
const JSON_CONTENT_TYPE = 'application/json';
const SECRET_PATH = '/convai/secrets';
const TOOL_PATH = '/convai/tools';
const DICTIONARY_PATH = '/pronunciation-dictionaries';
const CREATE_AGENT_PATH = '/convai/agents/create';
const AGENT_PATH = '/convai/agents';
const SECRET_NAME = 'field-guide-agent-llm';
const Method = { get: 'GET', create: 'POST', update: 'PATCH' } as const;
const INVALID_JSON = 'Invalid JSON response';

interface DictionaryResponse { id: string; version_id: string }
export interface DictionaryRule {
  readonly type: string;
  readonly string_to_replace: string;
  readonly alias?: string;
  readonly case_sensitive?: boolean;
  readonly word_boundaries?: boolean;
}

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
  return {
    secret: (value: string, id?: string) => request<{ secret_id: string }>(
      id ? `${SECRET_PATH}/${encodeURIComponent(id)}` : SECRET_PATH,
      id ? Method.update : Method.create,
      { type: id ? 'update' : 'new', name: SECRET_NAME, value },
    ),
    tool: (config: ClientToolConfig, id?: string) => request<{ id: string }>(
      id ? `${TOOL_PATH}/${encodeURIComponent(id)}` : TOOL_PATH,
      id ? Method.update : Method.create,
      { tool_config: config },
    ),
    dictionary: (name: string, rules: readonly PronunciationRule[]) =>
      request<DictionaryResponse>(DICTIONARY_PATH + '/add-from-rules', Method.create, { name, rules }),
    dictionaryRules: (id: string) => request<{ latest_version_id: string; rules: readonly DictionaryRule[] }>(
      `${DICTIONARY_PATH}/${encodeURIComponent(id)}`, Method.get,
    ),
    setDictionaryRules: (id: string, rules: readonly PronunciationRule[]) => request<DictionaryResponse>(
      `${DICTIONARY_PATH}/${encodeURIComponent(id)}/set-rules`, Method.create, { rules },
    ),
    agent: (config: ReturnType<typeof buildAgentConfig>, id?: string) => request<{ agent_id: string }>(
      id ? `${AGENT_PATH}/${encodeURIComponent(id)}` : CREATE_AGENT_PATH,
      id ? Method.update : Method.create, config,
    ),
  };
}
