import {
  AgentAudio,
  AgentTiming,
  createAgentClient,
  fetchSignedUrl,
  type AgentClientHandlers,
  type AudioPort,
  type SocketPort,
} from './agentClient';

const variables = {
  procedure: 'none',
  step: 'none',
  selected_part: 'none',
  opening: 'Hello',
};
const chunk = 'AAAA'.repeat(1600);
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
  const part = (text: string, type: string = 'start') =>
    receive({
      type: 'agent_chat_response_part',
      text_response_part: { text, type, event_id: 1 },
    });
  const start = async () => {
    const promise = client.start(variables, ['History', 'Screen']);
    await Promise.resolve();
    socket.onopen?.();
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
    audioEvent,
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
    AgentAudio.INPUT_RATE,
    AgentAudio.OUTPUT_RATE,
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
test('server and local interruptions drop stale audio and local text until a new response', async () => {
  const test = setup();
  await test.start();
  test.audioEvent(3);
  test.receive({ type: 'interruption', interruption_event: { event_id: 3 } });
  expect(test.audio.clear).toHaveBeenCalledTimes(1);
  test.audioEvent(2);
  test.audioEvent(3);
  expect(test.audio.play).toHaveBeenCalledTimes(1);
  test.part('New');
  test.audioEvent(4);
  test.client.interrupt();
  test.part(' stale', 'delta');
  test.audioEvent(4);
  test.audioEvent(5);
  expect(test.handlers.responseText).toHaveBeenLastCalledWith('New');
  expect(test.audio.play).toHaveBeenCalledTimes(2);
  test.part('Next');
  test.audioEvent(6);
  expect(test.audio.play).toHaveBeenCalledTimes(3);
  test.part(' reply', 'delta');
  expect(test.handlers.responseText).toHaveBeenLastCalledWith('Next reply');
  test.client.stop();
});
test('word ticks finish when audio plays out and do not leak into later replies', async () => {
  const test = setup();
  await test.start();
  test.part('Hi');
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
  test.part('Second');
  test.audioEvent(2);
  (test.audio.playedMs as jest.Mock).mockReturnValue(220);
  jest.advanceTimersByTime(AgentTiming.WORD_TICK_MS);
  expect(test.handlers.word).toHaveBeenLastCalledWith({
    location: 0,
    length: 2,
  });
  test.client.stop();
});
test.each([
  [1000, '', 'silence', 'ended', null],
  [1000, 'quota exceeded', 'quota', 'failed', 'quota'],
  [1008, '', 'auth', 'failed', 'auth'],
  [4002, '', 'auth', 'failed', 'auth'],
  [1006, '', 'network', 'failed', 'network'],
])(
  'close %s %s maps to %s exactly once',
  async (code, reason, end, state, failure) => {
    const test = setup();
    await test.start();
    const close = test.socket.onclose;
    close?.({ code, reason });
    test.client.stop();
    close?.({ code, reason });
    expect(test.handlers.ended).toHaveBeenCalledTimes(1);
    expect(test.handlers.ended).toHaveBeenCalledWith(end);
    expect(test.handlers.status).toHaveBeenLastCalledWith({
      state,
      reason: failure,
    });
    expect(test.audio.stop).toHaveBeenCalledTimes(1);
  },
);
test('stop, protocol failure and audio loss end exactly once', async () => {
  for (const reason of ['stopped', 'quota', 'auth', 'audio']) {
    const test = setup();
    await test.start();
    if (reason === 'stopped') {
      test.client.stop();
    } else if (reason === 'audio') {
      test.audioStopped();
    } else {
      test.receive({
        type: 'client_error',
        error_event: { code: 0, error_name: reason, message: reason },
      });
    }
    test.client.stop();
    expect(test.handlers.ended).toHaveBeenCalledTimes(1);
    expect(test.handlers.ended).toHaveBeenCalledWith(reason);
  }
});
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
test('signed URL accepts the Worker response and maps failures', async () => {
  for (const [status, body, expected] of [
    [200, { signedUrl: 'wss://fake' }, 'wss://fake'],
    [429, { error: 'voice quota' }, 'quota'],
    [503, { error: 'unavailable' }, 'auth'],
    [401, { error: 'voice auth' }, 'auth'],
    [500, {}, 'network'],
    [200, { signed_url: 'wrong contract' }, 'network'],
  ] as const) {
    const fetcher = jest.fn(async () => ({
      status,
      json: async () => body,
    })) as unknown as typeof fetch;
    const result = await fetchSignedUrl('https://worker', fetcher).catch(
      error => error.message,
    );
    expect(result).toBe(expected);
    expect(fetcher).toHaveBeenCalledWith(
      'https://worker/v1/voice/session',
      expect.objectContaining({ method: 'POST' }),
    );
  }
  await expect(
    fetchSignedUrl(
      'https://worker',
      jest.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    ),
  ).rejects.toThrow('network');
});

test('local interruption suppresses final text and corrections from the discarded response', async () => {
  const test = setup();
  await test.start();
  test.part('Old');
  test.client.interrupt();
  test.receive({
    type: 'agent_response',
    agent_response_event: { agent_response: 'Old final', event_id: 1 },
  });
  test.receive({
    type: 'agent_response_correction',
    agent_response_correction_event: {
      original_agent_response: 'Old final',
      corrected_agent_response: 'Old',
      event_id: 1,
    },
  });
  expect(test.handlers.response).not.toHaveBeenCalled();
  expect(test.handlers.correction).not.toHaveBeenCalled();
  test.part('Fresh');
  test.receive({
    type: 'agent_response',
    agent_response_event: { agent_response: 'Fresh final', event_id: 2 },
  });
  expect(test.handlers.response).toHaveBeenLastCalledWith('Fresh final');
  test.client.stop();
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
