import type { Pack } from '../../../apps/field-guide/src/features/pack/pack.ts';
import { rulesFor, ReplyFormat } from '../../../apps/field-guide/src/features/instructor/grounding.ts';
import { packKnowledge } from '../../../apps/field-guide/src/features/instructor/knowledge.ts';
import { agentVariables } from '../../../apps/field-guide/src/features/instructor/agent/agentVariables.ts';
import { recognitionHintsFor } from '../../../apps/field-guide/src/features/instructor/voice/recognitionHints.ts';
import { INITIAL_SESSION } from '../../../apps/field-guide/src/features/guide/session.ts';
import type { AgentState } from './state.ts';

export type AgentConfigIds = Required<Pick<AgentState, 'secretId' | 'dictionary'>> & {
  readonly workerUrl: string;
  readonly voiceId: string;
  readonly toolIds: readonly string[];
};
export const AGENT_NAME_PREFIX = 'Field Guide: ';
export const FIRST_MESSAGE = '{{opening}}';
export const LANGUAGE = 'en';
export const LLM = 'custom-llm';
export const MODEL_ID = 'field-guide';
export const LLM_BASE_PATH = '/v1';
export const CHAT_COMPLETIONS_API_TYPE = 'chat_completions';
export const TTS_MODEL_ID = 'eleven_flash_v2';
// The voice normalizes numbers after Claude answers, so the transcript on screen keeps 5W-40.
export const TEXT_NORMALISATION_TYPE = 'elevenlabs';
export const INPUT_AUDIO_FORMAT = 'pcm_16000';
export const OUTPUT_AUDIO_FORMAT = 'pcm_24000';
export const SILENCE_END_CALL_SECONDS = 20;
export const MAX_DURATION_SECONDS = 300;
export const ASR_QUALITY = 'high';
export const TURN_EAGERNESS = 'normal';
export const END_CALL_TOOL = 'end_call';
export const SYSTEM_TOOL_TYPE = 'system';
export const END_CALL_DESCRIPTION = 'Call when the user says goodbye or wants to stop talking.';
export const CLIENT_EVENTS = [
  'audio', 'interruption', 'user_transcript', 'agent_response',
  'agent_response_correction', 'agent_chat_response_part', 'agent_response_complete',
  'client_tool_call', 'agent_tool_response', 'ping', 'vad_score', 'conversation_initiation_metadata', 'client_error',
];

const VoiceStyle = [
  'Speak in short, plain sentences.',
  'Never use lists, markdown or emoji.',
  'Write numbers, grades and units as the notes write them, for example 5W-40.',
] as const;
const ToolInstructions = [
  'When the user asks about one specific part, such as where it is, what it does, or how to check, fill or change it, call show_part for it before you answer, even if they did not ask to see it.',
  'Match everyday words to the closest part, for example engine water means the coolant.',
  'When they ask to start a check, call start_procedure.',
  'For next, back, repeat, a step number or stopping, call the matching step tool.',
  'After a tool call, say its result in one short sentence and do not read the step again.',
  'When the user says goodbye or is done, say one short goodbye and call end_call with only a reason.',
  'A message that starts with [narrate] is read aloud by the app; never answer it.',
] as const;
const ScreenContext = [
  'The screen shows: {{step}}',
  'Selected part: {{selected_part}}',
  'Later screen changes arrive as context.',
] as const;

export function buildPrompt(pack: Pack): string {
  return [
    `You are the field instructor for the ${pack.title}, talking with someone standing at the machine with this guide open.`,
    ...VoiceStyle,
    ...rulesFor(pack, ReplyFormat.plain),
    ...ToolInstructions,
    ...ScreenContext,
    `Part ids: ${pack.parts.map(part => `${part.id} = ${part.name}`).join(', ')}`,
    `Check ids: ${pack.procedures.map(procedure => `${procedure.id} = ${procedure.title}`).join(', ')}`,
    packKnowledge(pack),
  ].join('\n');
}

export function buildAgentConfig(pack: Pack, ids: AgentConfigIds) {
  return {
    name: AGENT_NAME_PREFIX + pack.title,
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE,
        language: LANGUAGE,
        dynamic_variables: {
          dynamic_variable_placeholders: agentVariables(INITIAL_SESSION, pack, false),
        },
        prompt: {
          prompt: buildPrompt(pack),
          llm: LLM,
          custom_llm: {
            url: ids.workerUrl.replace(/\/+$/, '') + LLM_BASE_PATH,
            model_id: MODEL_ID,
            api_key: { secret_id: ids.secretId },
            api_type: CHAT_COMPLETIONS_API_TYPE,
          },
          tool_ids: [...ids.toolIds],
          built_in_tools: {
            [END_CALL_TOOL]: {
              type: SYSTEM_TOOL_TYPE, name: END_CALL_TOOL, description: END_CALL_DESCRIPTION,
              params: { system_tool_type: END_CALL_TOOL },
            },
          },
        },
      },
      asr: {
        quality: ASR_QUALITY,
        user_input_audio_format: INPUT_AUDIO_FORMAT,
        keywords: recognitionHintsFor(pack),
      },
      tts: {
        model_id: TTS_MODEL_ID,
        voice_id: ids.voiceId,
        agent_output_audio_format: OUTPUT_AUDIO_FORMAT,
        text_normalisation_type: TEXT_NORMALISATION_TYPE,
        pronunciation_dictionary_locators: [{
          pronunciation_dictionary_id: ids.dictionary.id,
          version_id: ids.dictionary.versionId,
        }],
      },
      turn: { turn_eagerness: TURN_EAGERNESS, silence_end_call_timeout: SILENCE_END_CALL_SECONDS },
      conversation: { max_duration_seconds: MAX_DURATION_SECONDS, client_events: [...CLIENT_EVENTS] },
    },
    platform_settings: { auth: { enable_auth: true } },
  };
}
