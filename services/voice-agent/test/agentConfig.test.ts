import assert from 'node:assert/strict';
import test from 'node:test';
import { rulesFor, ReplyFormat } from '../../../apps/field-guide/src/features/instructor/grounding.ts';
import { packKnowledge } from '../../../apps/field-guide/src/features/instructor/knowledge.ts';
import { recognitionHintsFor } from '../../../apps/field-guide/src/features/instructor/voice/recognitionHints.ts';
import { agentVariables } from '../../../apps/field-guide/src/features/instructor/agent/agentVariables.ts';
import { INITIAL_SESSION } from '../../../apps/field-guide/src/features/guide/session.ts';
import { buildAgentConfig, buildPrompt } from '../src/agentConfig.ts';
import { pack } from './pack.ts';

test('the spoken instructor knows every part and check and follows the shared rules', () => {
  const prompt = buildPrompt(pack);
  assert.ok(prompt.startsWith(`You are the field instructor for the ${pack.title}, talking with someone standing at the machine with this guide open.`));
  for (const part of pack.parts) assert.ok(prompt.includes(`${part.id} = ${part.name}`));
  for (const procedure of pack.procedures) assert.ok(prompt.includes(`${procedure.id} = ${procedure.title}`));
  assert.ok(prompt.includes(rulesFor(pack, ReplyFormat.plain).join('\n')));
  assert.ok(prompt.endsWith(packKnowledge(pack)));
  for (const line of [
    'Speak in short, plain sentences, at most three per answer.',
    'Never use lists, markdown, symbols or emoji.',
    'Say numbers and units in words, for example four point five liters or twenty newton meters.',
    'When the user asks to see or find a part, call show_part.',
    'When they ask to start a check, call start_procedure.',
    'For next, back, repeat, a step number or stopping, call the matching step tool.',
    'After a tool call, say its result in one short sentence and do not read the step again.',
    'A message that starts with [narrate] is read aloud by the app; never answer it.',
    'The screen shows: {{step}}',
    'Selected part: {{selected_part}}',
    'Later screen changes arrive as context.',
  ]) assert.ok(prompt.includes(line), line);
  assert.doesNotMatch(prompt, /[\u2014\u00b7]/u);
});

test('the agent accepts the app audio and screen context through an authenticated conversation', () => {
  const config = buildAgentConfig(pack, {
    workerUrl: 'https://worker.example/', voiceId: 'owner-voice', secretId: 'llm-secret',
    toolIds: ['show-tool', 'next-tool'], dictionary: { id: 'terms', versionId: 'revision' },
  });
  assert.equal(config.name, `Field Guide: ${pack.title}`);
  assert.deepEqual(config.conversation_config.asr, {
    quality: 'high', user_input_audio_format: 'pcm_16000', keywords: recognitionHintsFor(pack),
  });
  assert.deepEqual(config.conversation_config.tts, {
    model_id: 'eleven_flash_v2', voice_id: 'owner-voice', agent_output_audio_format: 'pcm_24000',
    pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: 'terms', version_id: 'revision' }],
  });
  const agent = config.conversation_config.agent;
  assert.equal(agent.first_message, '{{opening}}');
  assert.equal(agent.language, 'en');
  assert.deepEqual(agent.dynamic_variables.dynamic_variable_placeholders, agentVariables(INITIAL_SESSION, pack, false));
  assert.equal(agent.prompt.llm, 'custom-llm');
  assert.deepEqual(agent.prompt.custom_llm, {
    url: 'https://worker.example/v1/chat/completions', model_id: 'field-guide',
    api_key: { secret_id: 'llm-secret' }, api_type: 'chat_completions',
  });
  assert.deepEqual(agent.prompt.tool_ids, ['show-tool', 'next-tool']);
  assert.deepEqual(config.conversation_config.turn, { turn_eagerness: 'normal', silence_end_call_timeout: 20 });
  assert.equal(config.conversation_config.conversation.max_duration_seconds, 300);
  for (const event of [
    'audio', 'interruption', 'user_transcript', 'agent_response', 'agent_response_correction',
    'agent_chat_response_part', 'agent_response_complete', 'client_tool_call', 'ping', 'vad_score',
    'conversation_initiation_metadata', 'client_error',
  ]) assert.ok(config.conversation_config.conversation.client_events.includes(event));
  assert.equal(config.platform_settings.auth.enable_auth, true);
});
