import { AGENT_METADATA, fakePlatform } from '@tests/platform';
import { VoiceSource } from '../domain/mode/modeTypes';
import { AgentState, ConnectionFailure } from '../domain/agent/agentStatus';
import { UtteranceKind, utteranceId } from '../domain/voice/voiceSession';
import { SpeechVoice, VOICE_LOCALE } from '../domain/voice/voiceCopy';
import {
  createInstructorStore,
  type InstructorStore,
} from '../state/instructorStore';

import { voiceEvents } from '@tests/voiceSession';
import { fixturePack } from '@tests/fixturePack';
import { ProxyPath } from '../data/proxy/proxyContract';
import { createInstructor } from '../createInstructor';
import {
  OfflineVoices,
  SwitchTiming,
  type OfflineVoice,
} from '../domain/mode/modeSwitching';
import type { Fetch, Platform } from '../../../platform/ports';
import type { PathInfo } from '../../../platform/connectivity/networkQuality';
import {
  PROBE_INTERVAL_MS,
  ProbeRetry,
} from '../../../platform/connectivity/networkService';
import { GrpcBackoff } from '../../../platform/connectivity/backoff';
import { ModeTiming } from '../domain/mode/modeController';

const PROXY_URL = 'https://proxy.example';
const WIFI: PathInfo = {
  satisfied: true,
  transport: 'wifi',
  downstreamKbps: -1,
  signalLevel: -1,
};
const signedUrl = async () => ({
  status: 200,
  json: async () => ({ signedUrl: 'wss://agent.example/session' }),
});

/** Builds the instructor over a fake platform; offline speech defaults to Kokoro, as on iOS. */
function instructorOn(
  platform: Platform,
  options: {
    proxyUrl?: string | null;
    store?: InstructorStore;
    offlineVoice?: OfflineVoice;
  } = {},
) {
  return createInstructor({
    platform,
    proxyUrl: options.proxyUrl === undefined ? PROXY_URL : options.proxyUrl,
    offlineVoice: options.offlineVoice ?? OfflineVoices.kokoro,
    store: options.store ?? createInstructorStore(),
  });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test.each(['online', 'offline'] as const)(
  '%s voice survives the microphone prompt but stops on a real background',
  async mode => {
    let allow!: () => void;
    const permission = new Promise<void>(resolve => {
      allow = resolve;
    });
    const fake = fakePlatform({
      fetch: jest.fn(signedUrl) as unknown as Fetch,
    });
    const { transport } = fake;
    const store = createInstructorStore();
    const instructor = instructorOn(fake.platform, {
      proxyUrl: mode === 'online' ? PROXY_URL : null,
      store,
    });
    if (mode === 'online') {
      fake.link.requestPermission.mockImplementationOnce(async () => {
        await permission;
        return true;
      });
    } else {
      fake.input.requestPermission.mockImplementationOnce(async () => {
        await permission;
        return 'granted';
      });
    }
    instructor.start();
    const pack = fixturePack();
    const session = instructor.sessionFor(pack)!.session;
    const changed = voiceEvents();
    const started = session.start(
      {
        pack,
        state: { procedureId: null, stepIndex: 0, selectedPart: null },
        history: [],
        thinking: false,
      },
      changed,
    );
    fake.appState.change('background');
    expect(store.getState().voice.foreground).toBe(true);
    fake.appState.change('active');
    allow();
    await jest.advanceTimersByTimeAsync(0);
    if (mode === 'online') {
      transport.ready();
    }
    await started;
    expect(changed.listening.mock.calls.at(-1)).toEqual([true]);
    fake.appState.change('background');
    fake.appState.change('active');
    expect(changed.listening.mock.calls.at(-1)).toEqual([false]);
    expect(transport.open).toBe(0);
    instructor.stop();
  },
);

test('without a proxy the instructor settles offline on the device while screens show the route', () => {
  const fake = fakePlatform();
  const store = createInstructorStore();
  const instructor = instructorOn(fake.platform, { proxyUrl: null, store });
  instructor.start();
  fake.network.emit(WIFI);
  expect(store.getState().mode).toMatchObject({
    mode: 'offline',
    cause: 'startup',
    voice: VoiceSource.device,
    answers: 'script',
  });
  expect(store.getState().network).toMatchObject({ transport: 'wifi' });
  expect(fake.platform.fetch).not.toHaveBeenCalled();
  instructor.stop();
});

test('a microphone prompt that settles in the background ends the pending conversation', async () => {
  let allow!: (permission: 'granted') => void;
  const fake = fakePlatform();
  fake.input.requestPermission.mockReturnValueOnce(
    new Promise(resolve => {
      allow = resolve;
    }),
  );
  const store = createInstructorStore();
  const instructor = instructorOn(fake.platform, { proxyUrl: null, store });
  instructor.start();
  const pack = fixturePack();
  const session = instructor.sessionFor(pack)!.session;
  const changed = voiceEvents();
  const started = session.start(
    {
      pack,
      state: { procedureId: null, stepIndex: 0, selectedPart: null },
      history: [],
      thinking: false,
    },
    changed,
  );
  fake.appState.change('background');
  expect(store.getState().voice.foreground).toBe(true);
  allow('granted');
  await started;
  expect(store.getState().voice.foreground).toBe(false);
  expect(changed.listening.mock.calls.at(-1)).toEqual([false]);
  expect(instructor.sessionFor(pack)).toBeNull();
  instructor.stop();
});

test.each([
  { offlineVoice: OfflineVoices.system, voice: 'system' },
  { offlineVoice: OfflineVoices.kokoro, voice: 'kokoro' },
] as const)(
  'offline conversations speak with the configured $voice voice',
  async ({ offlineVoice, voice }) => {
    const store = createInstructorStore();
    const fake = fakePlatform({
      fetch: jest.fn(async () => ({ status: 204 })) as unknown as Fetch,
    });
    const instructor = instructorOn(fake.platform, { store, offlineVoice });
    try {
      instructor.start();
      fake.network.emit(WIFI);
      fake.network.emit({ ...WIFI, satisfied: false });
      await jest.advanceTimersByTimeAsync(SwitchTiming.MIN_SWITCH_MS);
      expect(store.getState().mode.mode).toBe('offline');
      const session = instructor.sessionFor(fixturePack())!.session;
      await session.start(
        {
          pack: fixturePack(),
          state: { procedureId: null, stepIndex: 0, selectedPart: null },
          history: [],
          thinking: false,
        },
        voiceEvents(),
      );
      await session.say({
        id: 'offline-voice',
        kind: 'notice',
        reply: 'Offline.',
        caution: '',
        stepKey: null,
      });
      expect(fake.output.speak).toHaveBeenCalledWith(
        'Offline.',
        'en-US',
        expect.any(Function),
        voice,
      );
      session.stop();
    } finally {
      instructor.stop();
    }
  },
);

test('good network for ten seconds restores agent voice and reuses the prepared signed URL', async () => {
  const store = createInstructorStore();
  const fetchImpl = jest.fn(async (address: unknown) =>
    String(address).endsWith(ProxyPath.voiceSession)
      ? signedUrl()
      : { status: 204 },
  );
  const connect = jest.fn(() => ({
    send: jest.fn(),
    close: jest.fn(),
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null,
    onclose: null,
  }));
  const fake = fakePlatform({
    fetch: fetchImpl as unknown as Fetch,
    socket: connect,
  });
  const instructor = instructorOn(fake.platform, { store });
  const pack = fixturePack();
  instructor.setPack(pack);
  instructor.start();
  fake.network.emit(WIFI);
  await jest.advanceTimersByTimeAsync(0);
  fake.network.emit({ ...WIFI, satisfied: false });
  await jest.advanceTimersByTimeAsync(600);
  fake.network.emit(WIFI);
  await jest.advanceTimersByTimeAsync(9999);
  expect(store.getState().mode.mode).toBe('offline');
  await jest.advanceTimersByTimeAsync(1);
  expect(store.getState().mode.mode).toBe('switchingToOnline');
  await jest.advanceTimersByTimeAsync(600);
  expect(store.getState().mode).toMatchObject({
    mode: 'online',
    voice: 'agent',
    answers: 'claude',
  });
  const session = instructor.sessionFor(pack)!.session;
  const started = session.start(
    {
      pack,
      state: { procedureId: null, stepIndex: 0, selectedPart: null },
      history: [],
      thinking: false,
    },
    voiceEvents(),
  );
  await jest.advanceTimersByTimeAsync(0);
  const socket = connect.mock.results[0].value;
  socket.onopen?.();
  socket.onmessage?.({ data: JSON.stringify(AGENT_METADATA) });
  await started;
  expect(
    fetchImpl.mock.calls.filter(([address]) =>
      String(address).endsWith(ProxyPath.voiceSession),
    ),
  ).toHaveLength(1);
  session.stop();
  instructor.stop();
  expect(jest.getTimerCount()).toBe(0);
});

test('a Worker that stops answering goes offline within seconds and back online soon after it answers', async () => {
  const store = createInstructorStore();
  let reachable = true;
  const fetchImpl = jest.fn(async (address: unknown) => {
    if (!reachable) {
      throw new Error('Network request failed');
    }
    return String(address).endsWith(ProxyPath.voiceSession)
      ? signedUrl()
      : { status: 204 };
  });
  const fake = fakePlatform({ fetch: fetchImpl as unknown as Fetch });
  const instructor = instructorOn(fake.platform, { store });
  instructor.setPack(fixturePack());
  instructor.start();
  instructor.setInstructorOpen(true);
  fake.network.emit(WIFI);
  await jest.advanceTimersByTimeAsync(0);
  reachable = false;
  // The interval notices the loss, and two quick retries confirm it.
  await jest.advanceTimersByTimeAsync(
    PROBE_INTERVAL_MS +
      ProbeRetry.initialMs * (1 + GrpcBackoff.MULTIPLIER) +
      SwitchTiming.MIN_SWITCH_MS,
  );
  expect(store.getState().mode.mode).toBe('offline');
  reachable = true;
  // The next backoff retry and one confirming probe end the outage.
  await jest.advanceTimersByTimeAsync(
    ProbeRetry.initialMs * (GrpcBackoff.MULTIPLIER ** 2 + 1) +
      ModeTiming.RECOVERY_MS +
      SwitchTiming.MIN_SWITCH_MS,
  );
  expect(store.getState().mode).toMatchObject({
    mode: 'online',
    voice: 'agent',
    answers: 'claude',
  });
  instructor.stop();
  expect(jest.getTimerCount()).toBe(0);
});

test('quota keeps later conversations on device for the run and offline questions skip cloud requests', async () => {
  const store = createInstructorStore();
  const streamText = jest.fn();
  const fetchImpl = jest.fn(async (address: unknown) =>
    String(address).endsWith(ProxyPath.voiceSession)
      ? { status: 429, json: async () => ({ error: 'voice quota' }) }
      : { status: 204 },
  );
  const fake = fakePlatform({
    fetch: fetchImpl as unknown as Fetch,
    streamText,
  });
  const instructor = instructorOn(fake.platform, { store });
  const pack = fixturePack();
  instructor.setPack(pack);
  instructor.start();
  fake.network.emit(WIFI);
  await jest.advanceTimersByTimeAsync(0);
  const session = instructor.sessionFor(pack)!.session;
  await session.start(
    {
      pack,
      state: { procedureId: null, stepIndex: 0, selectedPart: null },
      history: [],
      thinking: false,
    },
    voiceEvents(),
  );
  expect(store.getState().mode).toMatchObject({
    mode: 'online',
    voice: 'device',
  });
  expect(store.getState().agent).toMatchObject({
    state: 'failed',
    reason: 'quota',
  });
  session.stop();
  expect(instructor.sessionFor(pack)?.questions).toBeNull();
  fake.network.emit({ ...WIFI, satisfied: false });
  await jest.advanceTimersByTimeAsync(600);
  await instructor.turns.ask(
    {
      question: 'Explain the battery',
      pack,
      state: { procedureId: null, stepIndex: 0, selectedPart: null },
      history: [],
    },
    jest.fn(),
  );
  expect(streamText).not.toHaveBeenCalled();
  fake.network.emit(WIFI);
  await jest.advanceTimersByTimeAsync(10600);
  expect(store.getState().mode).toMatchObject({
    mode: 'online',
    voice: 'device',
  });
  expect(
    fetchImpl.mock.calls.filter(([address]) =>
      String(address).endsWith(ProxyPath.voiceSession),
    ),
  ).toHaveLength(1);
  instructor.stop();
});

test('backgrounding closes the conversation without reconnecting', async () => {
  const store = createInstructorStore();
  const fake = fakePlatform({
    fetch: jest.fn(signedUrl) as unknown as Fetch,
  });
  const { transport } = fake;
  const instructor = instructorOn(fake.platform, { store });
  instructor.start();
  const pack = fixturePack();
  const session = instructor.sessionFor(pack)!.session;
  const changed = voiceEvents();
  const started = session.start(
    {
      pack,
      state: { procedureId: null, stepIndex: 0, selectedPart: null },
      history: [],
      thinking: false,
    },
    changed,
  );
  await jest.advanceTimersByTimeAsync(0);
  transport.ready();
  await started;
  fake.appState.change('background');
  expect(changed.listening.mock.calls.at(-1)).toEqual([false]);
  expect(transport.open).toBe(0);
  await jest.advanceTimersByTimeAsync(30000);
  expect(transport.open).toBe(0);
  instructor.stop();
});

test('active quota marks the agent unavailable and keeps this conversation and the next on device', async () => {
  const store = createInstructorStore();
  const fake = fakePlatform({
    fetch: jest.fn(signedUrl) as unknown as Fetch,
  });
  const { transport } = fake;
  const instructor = instructorOn(fake.platform, { store });
  const pack = fixturePack();
  const context = {
    pack,
    state: { procedureId: null, stepIndex: 0, selectedPart: null },
    history: [],
    thinking: false,
  };
  instructor.start();
  const voice = instructor.sessionFor(pack)!;
  const changed = voiceEvents();
  const questions: string[] = [];
  changed.question.mockImplementation(question => {
    questions.push(question);
    voice.session.say({
      id: utteranceId(UtteranceKind.answer, question),
      kind: UtteranceKind.answer,
      reply: 'Check the battery terminals.',
      caution: '',
      stepKey: null,
    });
  });
  const started = voice.session.start(context, changed);
  await jest.advanceTimersByTimeAsync(0);
  transport.ready();
  await started;
  voice.questions!.ask('Why check the battery?');
  transport.current.onclose?.({ code: 1000, reason: 'quota exceeded' });
  await jest.advanceTimersByTimeAsync(0);
  expect(store.getState().agent).toEqual({
    state: AgentState.failed,
    reason: ConnectionFailure.quota,
  });
  expect(store.getState().mode.voice).toBe(VoiceSource.device);
  expect(questions).toEqual(['Why check the battery?']);
  expect(fake.output.speak).toHaveBeenCalledWith(
    'Check the battery terminals.',
    VOICE_LOCALE,
    expect.any(Function),
    SpeechVoice.system,
  );
  expect(voice.questions).toBeNull();
  expect(transport.open).toBe(0);
  voice.session.stop();
  const next = instructor.sessionFor(pack)!;
  await next.session.start(context, voiceEvents());
  expect(next.questions).toBeNull();
  expect(transport.connections).toBe(1);
  next.session.stop();
  instructor.stop();
});

test('slow Claude first tokens on a good connection neither weaken the network nor suggest offline', async () => {
  const FIRST_TOKEN_MS = 1500;
  const QUESTIONS = 3;
  const SUGGESTION_WAIT_MS = 6000;
  const store = createInstructorStore();
  const slowStream = async function* () {
    await new Promise<void>(resolve => setTimeout(resolve, FIRST_TOKEN_MS));
    yield '{"text":"It supplies the starter."}\n{"done":true}\n';
  };
  const fake = fakePlatform({
    fetch: (async () => ({ status: 204 })) as unknown as Fetch,
    streamText: async () => ({ status: 200, chunks: slowStream() }),
  });
  const instructor = instructorOn(fake.platform, { store });
  const pack = fixturePack();
  instructor.setPack(pack);
  instructor.start();
  fake.network.emit(WIFI);
  await jest.advanceTimersByTimeAsync(0);
  for (let asked = 0; asked < QUESTIONS; asked++) {
    const answer = instructor.turns.ask(
      {
        question: 'Explain the battery',
        pack,
        state: { procedureId: null, stepIndex: 0, selectedPart: null },
        history: [],
      },
      jest.fn(),
    );
    await jest.advanceTimersByTimeAsync(FIRST_TOKEN_MS);
    await answer;
  }
  await jest.advanceTimersByTimeAsync(SUGGESTION_WAIT_MS);
  expect(store.getState().network.quality).toBe('good');
  expect(store.getState().suggestion).toBeNull();
  instructor.stop();
});
