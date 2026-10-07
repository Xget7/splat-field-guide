import type { AgentVariables } from './agentVariables';

export interface Alignment {
  readonly chars: readonly string[];
  readonly startsMs: readonly number[];
  readonly durationsMs: readonly number[];
}

export type AgentServerEvent =
  | {
      readonly type: 'metadata';
      readonly conversationId: string;
      readonly outputFormat: string;
      readonly inputFormat: string;
    }
  | { readonly type: 'userTranscript'; readonly text: string }
  | {
      readonly type: 'responsePart';
      readonly part: 'start' | 'delta' | 'stop';
      readonly text: string;
    }
  | { readonly type: 'response'; readonly text: string }
  | {
      readonly type: 'correction';
      readonly original: string;
      readonly corrected: string;
    }
  | {
      readonly type: 'audio';
      readonly audio: string;
      readonly eventId: number;
      readonly alignment: Alignment | null;
    }
  | { readonly type: 'interruption'; readonly eventId: number }
  | {
      readonly type: 'ping';
      readonly eventId: number;
      readonly pingMs: number | null;
    }
  | {
      readonly type: 'toolCall';
      readonly name: string;
      readonly id: string;
      readonly parameters: unknown;
      readonly expectsResponse: boolean;
    }
  | { readonly type: 'responseComplete' }
  | {
      readonly type: 'error';
      readonly code: number;
      readonly name: string;
      readonly message: string;
    };

type Fields = Record<string, unknown>;
function object(value: unknown): Fields | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Fields)
    : null;
}
const text = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const eventId = (value: unknown): value is number =>
  number(value) && Number.isInteger(value) && value >= 0;
function alignment(value: unknown): Alignment | null {
  const fields = object(value);
  if (!fields) {
    return null;
  }
  const chars = fields.chars;
  const startsMs = fields.char_start_times_ms;
  const durationsMs = fields.char_durations_ms;
  if (
    !Array.isArray(chars) ||
    !chars.every(text) ||
    !Array.isArray(startsMs) ||
    !startsMs.every(start => number(start) && start >= 0) ||
    !Array.isArray(durationsMs) ||
    !durationsMs.every(duration => number(duration) && duration >= 0) ||
    chars.length !== startsMs.length ||
    chars.length !== durationsMs.length
  ) {
    return null;
  }
  return { chars, startsMs, durationsMs };
}
export function parseServerMessage(data: string): AgentServerEvent | null {
  let message: Fields | null;
  try {
    message = object(JSON.parse(data));
  } catch {
    return null;
  }
  if (!message) {
    return null;
  }
  const fields = (key: string) => object(message[key]);
  switch (message.type) {
    case 'conversation_initiation_metadata': {
      const value = fields('conversation_initiation_metadata_event');
      return value &&
        text(value.conversation_id) &&
        text(value.agent_output_audio_format) &&
        text(value.user_input_audio_format)
        ? {
            type: 'metadata',
            conversationId: value.conversation_id,
            outputFormat: value.agent_output_audio_format,
            inputFormat: value.user_input_audio_format,
          }
        : null;
    }
    case 'user_transcript': {
      const value = fields('user_transcription_event');
      return value && text(value.user_transcript) && eventId(value.event_id)
        ? { type: 'userTranscript', text: value.user_transcript }
        : null;
    }
    case 'agent_chat_response_part': {
      const value = fields('text_response_part');
      return value &&
        text(value.text) &&
        eventId(value.event_id) &&
        (value.type === 'start' ||
          value.type === 'delta' ||
          value.type === 'stop')
        ? { type: 'responsePart', text: value.text, part: value.type }
        : null;
    }
    case 'agent_response': {
      const value = fields('agent_response_event');
      return value && text(value.agent_response) && eventId(value.event_id)
        ? { type: 'response', text: value.agent_response }
        : null;
    }
    case 'agent_response_correction': {
      const value = fields('agent_response_correction_event');
      return value &&
        text(value.original_agent_response) &&
        text(value.corrected_agent_response) &&
        eventId(value.event_id)
        ? {
            type: 'correction',
            original: value.original_agent_response,
            corrected: value.corrected_agent_response,
          }
        : null;
    }
    case 'audio': {
      const value = fields('audio_event');
      return value && text(value.audio_base_64) && eventId(value.event_id)
        ? {
            type: 'audio',
            audio: value.audio_base_64,
            eventId: value.event_id,
            alignment: alignment(value.alignment),
          }
        : null;
    }
    case 'interruption': {
      const value = fields('interruption_event');
      return value && eventId(value.event_id)
        ? { type: 'interruption', eventId: value.event_id }
        : null;
    }
    case 'ping': {
      const value = fields('ping_event');
      return value &&
        eventId(value.event_id) &&
        (value.ping_ms === undefined ||
          value.ping_ms === null ||
          number(value.ping_ms))
        ? {
            type: 'ping',
            eventId: value.event_id,
            pingMs: number(value.ping_ms) ? value.ping_ms : null,
          }
        : null;
    }
    case 'client_tool_call': {
      const value = fields('client_tool_call');
      return value &&
        text(value.tool_name) &&
        text(value.tool_call_id) &&
        'parameters' in value &&
        eventId(value.event_id) &&
        typeof value.expects_response === 'boolean'
        ? {
            type: 'toolCall',
            name: value.tool_name,
            id: value.tool_call_id,
            parameters: value.parameters,
            expectsResponse: value.expects_response,
          }
        : null;
    }
    case 'agent_response_complete': {
      const value = fields('agent_response_complete_event');
      return value && eventId(value.event_id)
        ? { type: 'responseComplete' }
        : null;
    }
    case 'client_error': {
      const value = fields('error_event');
      return value &&
        number(value.code) &&
        text(value.error_name) &&
        text(value.message)
        ? {
            type: 'error',
            code: value.code,
            name: value.error_name,
            message: value.message,
          }
        : null;
    }
    default:
      return null;
  }
}
export const ClientMessage = {
  initiation: (variables: AgentVariables): string =>
    JSON.stringify({
      type: 'conversation_initiation_client_data',
      dynamic_variables: variables,
      conversation_config_override: {},
    }),
  audio: (chunk: string): string => JSON.stringify({ user_audio_chunk: chunk }),
  pong: (id: number): string => JSON.stringify({ type: 'pong', event_id: id }),
  toolResult: (id: string, result: string, isError: boolean): string =>
    JSON.stringify({
      type: 'client_tool_result',
      tool_call_id: id,
      result,
      is_error: isError,
    }),
  contextualUpdate: (value: string): string =>
    JSON.stringify({ type: 'contextual_update', text: value }),
  userMessage: (value: string): string =>
    JSON.stringify({ type: 'user_message', text: value }),
  userActivity: (): string => JSON.stringify({ type: 'user_activity' }),
};
