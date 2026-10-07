import {
  ClientMessage,
  parseServerMessage,
  pcmRate,
} from '../apps/field-guide/src/features/instructor/agent/agentProtocol';

const examples = [
  [
    {
      type: 'conversation_initiation_metadata',
      conversation_initiation_metadata_event: {
        conversation_id: 'conversation',
        agent_output_audio_format: 'pcm_24000',
        user_input_audio_format: 'pcm_16000',
      },
    },
    {
      type: 'metadata',
      conversationId: 'conversation',
      outputFormat: 'pcm_24000',
      inputFormat: 'pcm_16000',
    },
  ],
  [
    {
      type: 'user_transcript',
      user_transcription_event: { user_transcript: 'Question', event_id: 0 },
    },
    { type: 'userTranscript', text: 'Question' },
  ],
  [
    {
      type: 'agent_chat_response_part',
      text_response_part: { text: 'Reply', type: 'delta', event_id: 0 },
    },
    { type: 'responsePart', text: 'Reply', part: 'delta', eventId: 0 },
  ],
  [
    {
      type: 'agent_response',
      agent_response_event: { agent_response: 'Reply', event_id: 0 },
    },
    { type: 'response', text: 'Reply', eventId: 0 },
  ],
  [
    {
      type: 'agent_response_correction',
      agent_response_correction_event: {
        original_agent_response: 'Reply',
        corrected_agent_response: 'Re',
        event_id: 0,
      },
    },
    { type: 'correction', original: 'Reply', corrected: 'Re', eventId: 0 },
  ],
  [
    {
      type: 'audio',
      audio_event: {
        audio_base_64: 'AA==',
        event_id: 0,
        alignment: {
          chars: ['a'],
          char_start_times_ms: [0],
          char_durations_ms: [20],
        },
      },
    },
    {
      type: 'audio',
      audio: 'AA==',
      eventId: 0,
      alignment: { chars: ['a'], startsMs: [0], durationsMs: [20] },
    },
  ],
  [
    { type: 'interruption', interruption_event: { event_id: 0 } },
    { type: 'interruption', eventId: 0 },
  ],
  [
    { type: 'ping', ping_event: { event_id: 0, ping_ms: 30 } },
    { type: 'ping', eventId: 0, pingMs: 30 },
  ],
  [
    {
      type: 'client_tool_call',
      client_tool_call: {
        tool_name: 'show_part',
        tool_call_id: 'tool',
        parameters: {},
        event_id: 0,
        expects_response: true,
      },
    },
    {
      type: 'toolCall',
      name: 'show_part',
      id: 'tool',
      parameters: {},
      expectsResponse: true,
    },
  ],
  [
    {
      type: 'agent_response_complete',
      agent_response_complete_event: { event_id: 0 },
    },
    { type: 'responseComplete' },
  ],
  [
    {
      type: 'client_error',
      error_event: { code: 429, error_name: 'quota', message: 'limit' },
    },
    { type: 'error', code: 429, name: 'quota', message: 'limit' },
  ],
  [
    {
      type: 'error',
      error_event: { code: 1011, error_type: 'quota_exceeded', reason: 'cap' },
    },
    { type: 'error', code: 1011, name: 'quota_exceeded', message: 'cap' },
  ],
] as const;
test('every supported server message preserves its nested fields', () => {
  for (const [message, expected] of examples) {
    expect(parseServerMessage(JSON.stringify(message))).toEqual(expected);
  }
  expect(
    parseServerMessage(
      JSON.stringify({
        type: 'audio',
        audio_event: { audio_base_64: '', event_id: 1 },
      }),
    ),
  ).toEqual({ type: 'audio', audio: '', eventId: 1, alignment: null });
  expect(
    parseServerMessage(
      JSON.stringify({ type: 'ping', ping_event: { event_id: 1 } }),
    ),
  ).toEqual({ type: 'ping', eventId: 1, pingMs: null });
  expect(
    parseServerMessage(
      JSON.stringify({
        type: 'error',
        error_event: { error_type: 'internal' },
      }),
    ),
  ).toEqual({ type: 'error', code: 0, name: 'internal', message: '' });
  expect(
    parseServerMessage(
      JSON.stringify({
        type: 'client_tool_call',
        client_tool_call: {
          tool_name: 'next_step',
          tool_call_id: 'tool',
          parameters: {},
          event_id: 0,
        },
      }),
    ),
  ).toMatchObject({ type: 'toolCall', expectsResponse: true });
});
test('only PCM formats give a sample rate', () => {
  expect(pcmRate('pcm_24000')).toBe(24000);
  expect(pcmRate('ulaw_8000')).toBeNull();
  expect(pcmRate('pcm_')).toBeNull();
});
test('malformed, unknown and incomplete messages cannot enter the client', () => {
  for (const data of [
    '{',
    'null',
    '[]',
    '{}',
    ...examples.map(([message]) => JSON.stringify({ type: message.type })),
    JSON.stringify({ type: 'vad_score', vad_score_event: { vad_score: 0.5 } }),
  ]) {
    expect(parseServerMessage(data)).toBeNull();
  }
  expect(
    parseServerMessage(
      JSON.stringify({
        type: 'audio',
        audio_event: { audio_base_64: 'AA==', event_id: '1' },
      }),
    ),
  ).toBeNull();
  expect(
    parseServerMessage(
      JSON.stringify({
        type: 'agent_chat_response_part',
        text_response_part: { text: '', type: 'invalid', event_id: 0 },
      }),
    ),
  ).toBeNull();
});
test('client messages preserve audio, tool results and activity payloads', () => {
  expect(JSON.parse(ClientMessage.audio('AA=='))).toEqual({
    user_audio_chunk: 'AA==',
  });
  expect(JSON.parse(ClientMessage.toolResult('tool', 'Ready', false))).toEqual({
    type: 'client_tool_result',
    tool_call_id: 'tool',
    result: 'Ready',
    is_error: false,
  });
  expect(JSON.parse(ClientMessage.userActivity())).toEqual({
    type: 'user_activity',
  });
});
