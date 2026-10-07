import assert from 'node:assert/strict';
import test from 'node:test';
import { agentVariables } from '../../../apps/field-guide/src/features/instructor/agent/agentVariables.ts';
import { INITIAL_SESSION } from '../../../apps/field-guide/src/features/guide/session.ts';
import {
  buildAgentConfig, LLM_BASE_PATH, LLM, MODEL_ID, CHAT_COMPLETIONS_API_TYPE,
  TTS_MODEL_ID, TEXT_NORMALISATION_TYPE, INPUT_AUDIO_FORMAT, OUTPUT_AUDIO_FORMAT,
} from '../src/agentConfig.ts';
import { pack } from './pack.ts';

test('the agent carries the pack, screen variables and owner voice through a secret reference', () => {
  const config = buildAgentConfig(pack, {
    workerUrl: 'https://worker.example/', voiceId: 'owner-voice', secretId: 'llm-secret-id',
    toolIds: ['show-tool', 'next-tool'], dictionary: { id: 'terms', versionId: 'revision' },
  });
  const agent = config.conversation_config.agent;
  for (const part of pack.parts) assert.ok(agent.prompt.prompt.includes(part.name));
  for (const procedure of pack.procedures) assert.ok(agent.prompt.prompt.includes(procedure.title));
  assert.deepEqual(agent.dynamic_variables.dynamic_variable_placeholders, agentVariables(INITIAL_SESSION, pack, false));
  assert.deepEqual(agent.prompt.tool_ids, ['show-tool', 'next-tool']);
  assert.deepEqual(agent.prompt.custom_llm.api_key, { secret_id: 'llm-secret-id' });
  assert.equal(agent.prompt.llm, LLM);
  assert.equal(agent.prompt.custom_llm.model_id, MODEL_ID);
  assert.equal(agent.prompt.custom_llm.api_type, CHAT_COMPLETIONS_API_TYPE);
  assert.equal(config.conversation_config.tts.voice_id, 'owner-voice');
  assert.equal(config.conversation_config.tts.model_id, TTS_MODEL_ID);
  assert.equal(config.conversation_config.tts.text_normalisation_type, TEXT_NORMALISATION_TYPE);
  assert.equal(config.conversation_config.asr.user_input_audio_format, INPUT_AUDIO_FORMAT);
  assert.equal(config.conversation_config.tts.agent_output_audio_format, OUTPUT_AUDIO_FORMAT);
  assert.equal(config.platform_settings.auth.enable_auth, true);
});

test('the custom LLM URL lets ElevenLabs append the chat completions path once', () => {
  const config = buildAgentConfig(pack, {
    workerUrl: 'https://worker.example/', voiceId: 'owner-voice', secretId: 'llm-secret-id',
    toolIds: [], dictionary: { id: 'terms', versionId: 'revision' },
  });
  assert.equal(config.conversation_config.agent.prompt.custom_llm.url, 'https://worker.example' + LLM_BASE_PATH);
});
