import {
  AgentTiming,
  createAgentClient,
  fetchSignedUrl,
  type AgentClientHandlers,
  type AudioPort,
  type SocketPort,
} from '../apps/field-guide/src/features/instructor/agent/agentClient';

const variables = {
  procedure: 'none',
  step: 'none',
  selected_part: 'none',
  opening: 'Hello',
};
const chunk = 'AAAA'.repeat(1600);
const Format = { input: 'pcm_16000', output: 'pcm_24000' } as const;
const Rate = { input: 16000, output: 24000 } as const;
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
function setup() {
  const socket: SocketPort = {
    send: jest.fn(),
    close: jest.fn(),
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
  let input!: (value: string) => void;
  let stopped!: (reason: string) => void;
  const audio: AudioPort = {
    start: jest.fn(async (_in, _out, onInput, _level, onStopped) => {
      input = onInput;
      stopped = onStopped;
    }),
    play: jest.fn(),
    clear: jest.fn(),
    playedMs: jest.fn(() => 0),
    stop: jest.fn(),
  };
  const handlers: AgentClientHandlers = {
    status: jest.fn(),
    userTranscript: jest.fn(),
    responseText: jest.fn(),
    response: jest.fn(),
    correction: jest.fn(),
    interruption: jest.fn(),
    speaking: jest.fn(),
    word: jest.fn(),
    level: jest.fn(),
    toolCall: jest.fn(() => ({ result: 'Ready', isError: false })),
    roundTrip: jest.fn(),
    ended: jest.fn(),
  };
  const client = createAgentClient({
    signedUrl: async () => 'wss://fake',
    connect: () => socket,
    audio,
    handlers,
  });
  const receive = (message: unknown) =>
    socket.onmessage?.({ data: JSON.stringify(message) });
  const audioEvent = (id: number) =>
    receive({
      type: 'audio',
      audio_event: {
        event_id: id,
        audio_base_64: chunk,
        alignment: {
          chars: ['H', 'i'],
          char_start_times_ms: [0, 40],
          char_durations_ms: [40, 40],
        },
      },
    });
  const respond = (id: number, text: string) =>
    receive({
      type: 'agent_response',
      agent_response_event: { agent_response: text, event_id: id },
    });
  const interrupt = (id: number) =>
    receive({ type: 'interruption', interruption_event: { event_id: id } });
  const correct = (id: number, original: string, corrected: string) =>
    receive({
      type: 'agent_response_correction',
      agent_response_correction_event: {
        original_agent_response: original,
        corrected_agent_response: corrected,
        event_id: id,
      },
    });
  const metadata = (
    inputFormat: string = Format.input,
    outputFormat: string = Format.output,
  ) =>
    receive({
      type: 'conversation_initiation_metadata',
      conversation_initiation_metadata_event: {
        conversation_id: 'conversation',
        user_input_audio_format: inputFormat,
        agent_output_audio_format: outputFormat,
      },
    });
  const part = (text: string, type: string = 'start') =>
    receive({
      type: 'agent_chat_response_part',
      text_response_part: { text, type, event_id: 1 },
    });
  const start = async () => {
    const promise = client.start(variables, ['History', 'Screen']);
    await Promise.resolve();
    socket.onopen?.();
    metadata();
    await promise;
  };
  const messages = () =>
    (socket.send as jest.Mock).mock.calls.map(([message]) =>
      JSON.parse(message),
    );
  return {
    client,
    socket,
    audio,
    handlers,
    receive,
    respond,
    interrupt,
    correct,
    audioEvent,
    metadata,
    part,
    start,
    messages,
    input: (value: string) => input(value),
    audioStopped: () => stopped('interrupted'),
  };
}
test('initiation precedes context and microphone, ping and tools use their wire shapes', async () => {
  const test = setup();
  await test.start();
  expect(test.messages().map(message => message.type)).toEqual([
    'conversation_initiation_client_data',
    'contextual_update',
    'contextual_update',
  ]);
  expect(test.audio.start).toHaveBeenCalledWith(
    Rate.input,
    Rate.output,
    expect.any(Function),
    expect.any(Function),
    expect.any(Function),
  );
  test.input('first');
  test.client.setMuted(true);
  test.input('muted');
  test.client.setMuted(false);
  expect(test.messages().filter(message => message.user_audio_chunk)).toEqual([
    { user_audio_chunk: 'first' },
  ]);
  test.receive({ type: 'ping', ping_event: { event_id: 42, ping_ms: 60 } });
  expect(test.messages().at(-1)).toEqual({ type: 'pong', event_id: 42 });
  expect(test.handlers.roundTrip).toHaveBeenCalledWith(60);
  test.receive({
    type: 'client_tool_call',
    client_tool_call: {
      tool_name: 'next_step',
      tool_call_id: 'tool',
      parameters: {},
      event_id: 2,
      expects_response: true,
    },
  });
  expect(test.messages().at(-1)).toEqual({
    type: 'client_tool_result',
    tool_call_id: 'tool',
    result: 'Ready',
    is_error: false,
  });
  test.client.sendText('Question');
  test.client.sendContext('New screen');
  expect(test.messages().slice(-2)).toEqual([
    { type: 'user_message', text: 'Question' },
    { type: 'contextual_update', text: 'New screen' },
  ]);
  test.client.stop();
});
test('local interruption accepts the next reply without streamed text parts', async () => {
  const test = setup();
  await test.start();
  test.respond(3, 'Old');
  test.client.interrupt();
  test.respond(3, 'Old tail');
  test.audioEvent(3);
  test.respond(4, 'Hi');
  test.audioEvent(4);
  expect(
    (test.handlers.response as jest.Mock).mock.calls.map(([text]) => text),
  ).toEqual(['Old', 'Hi']);
  expect(test.audio.play).toHaveBeenCalledWith(chunk);
  (test.audio.playedMs as jest.Mock).mockReturnValue(40);
  jest.advanceTimersByTime(AgentTiming.WORD_TICK_MS);
  expect(test.handlers.word).toHaveBeenLastCalledWith({
    location: 0,
    length: 2,
  });
  test.client.stop();
});
test('word ticks finish when audio plays out and do not leak into later replies', async () => {
  const test = setup();
  await test.start();
  test.part('H');
  test.part('i', 'delta');
  expect(test.handlers.responseText).toHaveBeenLastCalledWith('Hi', 1);
  test.audioEvent(1);
  (test.audio.playedMs as jest.Mock).mockReturnValue(40);
  jest.advanceTimersByTime(AgentTiming.WORD_TICK_MS);
  expect(test.handlers.word).toHaveBeenLastCalledWith({
    location: 0,
    length: 2,
  });
  (test.audio.playedMs as jest.Mock).mockReturnValue(200);
  jest.advanceTimersByTime(AgentTiming.WORD_TICK_MS);
  expect(test.handlers.speaking).toHaveBeenLastCalledWith(false);
  expect(test.handlers.word).toHaveBeenLastCalledWith(null);
  test.client.stop();
});
test.each([
  [1000, 'quota exceeded', 429, 'voice quota', 'quota'],
  [1008, '', 503, 'voice auth', 'auth'],
  [1006, '', 500, 'unavailable', 'network'],
] as const)(
  'a %s failure ends once and the Worker reports the same class',
  async (code, reason, status, error, failure) => {
    const test = setup();
    await test.start();
    const close = test.socket.onclose;
    close?.({ code, reason });
    test.client.stop();
    close?.({ code, reason });
    expect(test.handlers.ended).toHaveBeenCalledTimes(1);
    expect(test.handlers.ended).toHaveBeenCalledWith(failure);
    expect(test.handlers.status).toHaveBeenLastCalledWith({
      state: 'failed',
      reason: failure,
    });
    const fetcher = async () => ({ status, json: async () => ({ error }) });
    await expect(
      fetchSignedUrl('https://worker', fetcher as unknown as typeof fetch),
    ).rejects.toThrow(failure);
    if (failure !== 'network') {
      const protocol = setup();
      await protocol.start();
      protocol.receive({
        type: 'client_error',
        error_event: { code, error_name: failure, message: reason },
      });
      expect(protocol.handlers.status).toHaveBeenLastCalledWith({
        state: 'failed',
        reason: failure,
      });
    }
  },
);
test.each(['silence', 'stopped', 'audio'])(
  'a conversation ends %s exactly once',
  async reason => {
    const test = setup();
    await test.start();
    if (reason === 'silence') {
      test.socket.onclose?.({ code: 1000, reason: '' });
    } else if (reason === 'audio') {
      test.audioStopped();
    } else {
      test.client.stop();
    }
    test.client.stop();
    expect(test.handlers.ended).toHaveBeenCalledTimes(1);
    expect(test.handlers.ended).toHaveBeenCalledWith(reason);
  },
);
test('a pending start times out or can be stopped without a late connection', async () => {
  const handlers = setup().handlers;
  const connect = jest.fn();
  let resolve!: (url: string) => void;
  const client = createAgentClient({
    signedUrl: () =>
      new Promise(done => {
        resolve = done;
      }),
    connect,
    audio: setup().audio,
    handlers,
  });
  const rejected = client.start(variables, []).catch(error => error.message);
  jest.advanceTimersByTime(AgentTiming.CONNECT_TIMEOUT_MS);
  expect(await rejected).toBe('network');
  resolve('wss://late');
  await Promise.resolve();
  expect(connect).not.toHaveBeenCalled();
  expect(handlers.ended).toHaveBeenCalledTimes(1);
});
test('the signed URL request uses the Worker contract', async () => {
  const fetcher = jest.fn(async () => ({
    status: 200,
    json: async () => ({ signedUrl: 'wss://fake' }),
  })) as unknown as typeof fetch;
  expect(await fetchSignedUrl('https://worker', fetcher)).toBe('wss://fake');
  expect(fetcher).toHaveBeenCalledWith('https://worker/v1/voice/session', {
    method: 'POST',
  });
});

test('stopping during connection rejects start and stale callbacks cannot stream', async () => {
  const test = setup();
  const pending = test.client
    .start(variables, [])
    .catch(error => error.message);
  await Promise.resolve();
  const open = test.socket.onopen;
  test.client.stop();
  open?.();
  expect(await pending).toBe('unknown');
  expect(test.audio.start).not.toHaveBeenCalled();
  expect(test.handlers.ended).toHaveBeenCalledTimes(1);
  expect(test.handlers.ended).toHaveBeenCalledWith('stopped');
});

test('server interruption accepts its event id and highlights only the new reply', async () => {
  const test = setup();
  await test.start();
  test.respond(4, 'Old reply');
  test.audioEvent(4);
  test.receive({ type: 'interruption', interruption_event: { event_id: 5 } });
  test.respond(4, 'Old tail');
  test.audioEvent(4);
  test.respond(5, 'Hi');
  test.audioEvent(5);
  expect(test.audio.clear).toHaveBeenCalledTimes(1);
  expect(test.audio.play).toHaveBeenCalledTimes(2);
  expect(test.handlers.response).toHaveBeenLastCalledWith('Hi', 5);
  (test.audio.playedMs as jest.Mock).mockReturnValue(40);
  jest.advanceTimersByTime(AgentTiming.WORD_TICK_MS);
  expect(test.handlers.word).toHaveBeenLastCalledWith({
    location: 0,
    length: 2,
  });
  test.client.stop();
});

test('a corrected reply bounds current and later word highlights to the shown text', async () => {
  const test = setup();
  await test.start();
  test.respond(1, 'Hi');
  test.audioEvent(1);
  (test.audio.playedMs as jest.Mock).mockReturnValue(20);
  jest.advanceTimersByTime(AgentTiming.WORD_TICK_MS);
  test.correct(1, 'Hi', 'H');
  expect(test.handlers.correction).toHaveBeenLastCalledWith('H', 1);
  expect(test.handlers.word).toHaveBeenLastCalledWith({
    location: 0,
    length: 1,
  });
  jest.advanceTimersByTime(AgentTiming.WORD_TICK_MS);
  expect(test.handlers.word).toHaveBeenLastCalledWith({
    location: 0,
    length: 1,
  });
  test.respond(1, '');
  expect(test.handlers.word).toHaveBeenLastCalledWith(null);
  test.audioEvent(1);
  (test.audio.playedMs as jest.Mock).mockReturnValue(140);
  jest.advanceTimersByTime(AgentTiming.WORD_TICK_MS);
  expect(test.handlers.word).toHaveBeenLastCalledWith(null);
  test.client.stop();
});

test('a new conversation starts with an unmuted microphone', async () => {
  const test = setup();
  await test.start();
  test.client.setMuted(true);
  test.client.stop();
  await test.start();
  test.input('new question');
  expect(test.messages().at(-1)).toEqual({ user_audio_chunk: 'new question' });
  test.client.stop();
});

test('audio waits for the negotiated formats and holds early events until the microphone is ready', async () => {
  const test = setup();
  let ready!: () => void;
  (test.audio.start as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        ready = resolve;
      }),
  );
  const started = test.client.start(variables, []);
  await Promise.resolve();
  test.socket.onopen?.();
  expect(test.audio.start).not.toHaveBeenCalled();
  test.metadata(Format.input, Format.input);
  expect(test.audio.start).toHaveBeenCalledWith(
    Rate.input,
    Rate.input,
    expect.any(Function),
    expect.any(Function),
    expect.any(Function),
  );
  test.respond(1, 'Hi');
  test.audioEvent(1);
  expect(test.audio.play).not.toHaveBeenCalled();
  ready();
  await started;
  expect(test.handlers.response).toHaveBeenCalledWith('Hi', 1);
  expect(test.audio.play).toHaveBeenCalledWith(chunk);
  (test.audio.playedMs as jest.Mock).mockReturnValue(120);
  jest.advanceTimersByTime(AgentTiming.WORD_TICK_MS);
  expect(test.handlers.speaking).toHaveBeenLastCalledWith(true);
  test.client.stop();
});
test('an output format the speaker cannot play ends the start', async () => {
  const test = setup();
  const started = test.client
    .start(variables, [])
    .catch(error => error.message);
  await Promise.resolve();
  test.socket.onopen?.();
  test.metadata(Format.input, 'ulaw_8000');
  expect(await started).toBe('unknown');
  expect(test.audio.start).not.toHaveBeenCalled();
  expect(test.handlers.ended).toHaveBeenCalledWith('error');
});
test('a socket error yields to the close that explains it', async () => {
  const test = setup();
  await test.start();
  test.socket.onerror?.();
  test.socket.onclose?.({ code: 1008, reason: '' });
  jest.runOnlyPendingTimers();
  expect(jest.mocked(test.handlers.ended).mock.calls).toEqual([['auth']]);
  const bare = setup();
  await bare.start();
  bare.socket.onerror?.();
  jest.runOnlyPendingTimers();
  expect(jest.mocked(bare.handlers.ended).mock.calls).toEqual([['network']]);
});
test('a server error ends the conversation only for quota or auth', async () => {
  const test = setup();
  await test.start();
  test.receive({
    type: 'error',
    error_event: { error_type: 'llm_error', message: 'Upstream failed' },
  });
  expect(test.handlers.ended).not.toHaveBeenCalled();
  test.receive({
    type: 'error',
    error_event: { code: 1011, error_type: 'quota_exceeded' },
  });
  expect(jest.mocked(test.handlers.ended).mock.calls).toEqual([['quota']]);
});
test('the correction of an interrupted reply still reaches its exchange', async () => {
  const test = setup();
  await test.start();
  test.respond(3, 'Old reply');
  test.audioEvent(3);
  test.interrupt(4);
  test.correct(3, 'Old reply', 'Old');
  expect(test.handlers.correction).toHaveBeenLastCalledWith('Old', 3);
});
test('a playback clock reset after an interruption restarts the reply timing', async () => {
  const test = setup();
  await test.start();
  (test.audio.playedMs as jest.Mock).mockReturnValue(5000);
  test.respond(1, 'Old');
  test.audioEvent(1);
  test.interrupt(2);
  test.respond(2, 'Hi');
  test.audioEvent(2);
  (test.audio.playedMs as jest.Mock).mockReturnValue(200);
  jest.advanceTimersByTime(AgentTiming.WORD_TICK_MS);
  expect(test.handlers.speaking).toHaveBeenLastCalledWith(false);
  test.client.stop();
});
