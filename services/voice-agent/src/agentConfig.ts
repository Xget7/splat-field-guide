import type { Pack } from '../../../apps/field-guide/src/features/pack/pack.ts';
import { rulesFor, ReplyFormat } from '../../../apps/field-guide/src/features/instructor/grounding.ts';
import { packKnowledge } from '../../../apps/field-guide/src/features/instructor/knowledge.ts';
import { agentVariables } from '../../../apps/field-guide/src/features/instructor/agent/agentVariables.ts';
import { recognitionHintsFor } from '../../../apps/field-guide/src/features/instructor/voice/recognitionHints.ts';
import { INITIAL_SESSION } from '../../../apps/field-guide/src/features/guide/session.ts';

export interface AgentConfigIds {
  readonly workerUrl: string;
  readonly voiceId: string;
  readonly secretId: string;
  readonly toolIds: readonly string[];
  readonly dictionary: { readonly id: string; readonly versionId: string };
}
const AGENT_NAME_PREFIX = 'Field Guide: ';
const FIRST_MESSAGE = '{{opening}}';
const LANGUAGE = 'en';
const LLM = 'custom-llm';
const MODEL_ID = 'field-guide';
const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';
const CHAT_COMPLETIONS_API_TYPE = 'chat_completions';
const TTS_MODEL_ID = 'eleven_flash_v2';
const INPUT_AUDIO_FORMAT = 'pcm_16000';
const OUTPUT_AUDIO_FORMAT = 'pcm_24000';
const SILENCE_END_CALL_SECONDS = 20;
const MAX_DURATION_SECONDS = 300;
const CLIENT_EVENTS = [
  'audio', 'interruption', 'user_transcript', 'agent_response',
  'agent_response_correction', 'agent_chat_response_part', 'agent_response_complete',
  'client_tool_call', 'ping', 'vad_score', 'conversation_initiation_metadata', 'client_error',
];

const VoiceStyle = [
  'Speak in short, plain sentences, at most three per answer.',
  'Never use lists, markdown, symbols or emoji.',
  'Say numbers and units in words, for example four point five liters or twenty newton meters.',
] as const;
const ToolInstructions = [
  'When the user asks to see or find a part, call show_part.',
  'When they ask to start a check, call start_procedure.',
  'For next, back, repeat, a step number or stopping, call the matching step tool.',
  'After a tool call, say its result in one short sentence and do not read the step again.',
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
            url: ids.workerUrl.replace(/\/+$/, '') + CHAT_COMPLETIONS_PATH,
            model_id: MODEL_ID,
            api_key: { secret_id: ids.secretId },
            api_type: CHAT_COMPLETIONS_API_TYPE,
          },
          tool_ids: [...ids.toolIds],
        },
      },
      asr: {
        quality: 'high',
        user_input_audio_format: INPUT_AUDIO_FORMAT,
        keywords: recognitionHintsFor(pack),
      },
      tts: {
        model_id: TTS_MODEL_ID,
        voice_id: ids.voiceId,
        agent_output_audio_format: OUTPUT_AUDIO_FORMAT,
        pronunciation_dictionary_locators: [{
          pronunciation_dictionary_id: ids.dictionary.id,
          version_id: ids.dictionary.versionId,
        }],
      },
      turn: { turn_eagerness: 'normal', silence_end_call_timeout: SILENCE_END_CALL_SECONDS },
      conversation: { max_duration_seconds: MAX_DURATION_SECONDS, client_events: [...CLIENT_EVENTS] },
    },
    platform_settings: { auth: { enable_auth: true } },
  };
}
