import { fakeAgentTransport } from './agentTransport';
import { Platform } from 'react-native';
import {
  AppEvent,
  VoiceSource,
  AgentState,
  ConnectionFailure,
} from '../apps/field-guide/src/features/events/types';
import {
  UtteranceKind,
  utteranceId,
} from '../apps/field-guide/src/features/instructor/voice/voiceSession';
import {
  SpeechVoice,
  VOICE_LOCALE,
} from '../apps/field-guide/src/features/instructor/voice/voiceCopy';
import { audioLink, speechInput, speechOutput } from 'react-native-on-device';
import { createEventBus } from '../apps/field-guide/src/features/events/bus';
import type { AppEvents } from '../apps/field-guide/src/features/events/types';
import { foregroundAppState, voiceEvents } from './voiceSession';
import { SwitchLabel } from '../apps/field-guide/src/features/instructor/mode/modeCopy';
import { fixturePack } from './fixturePack';
import { createInstructorRuntime } from '../apps/field-guide/src/app/instructorRuntime';
import type { NetworkPath } from 'react-native-on-device';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test.each(['online', 'offline'] as const)(
  '%s voice survives the microphone prompt but stops on a real background',
  async mode => {
    let state = 'active';
    let change!: (state: import('react-native').AppStateStatus) => void;
    let allow!: () => void;
    const permission = new Promise<void>(resolve => {
      allow = resolve;
    });
    const transport = fakeAgentTransport();
    const runtime = createInstructorRuntime({
      appEvents: createEventBus<AppEvents>(),
      proxyUrl: mode === 'online' ? 'https://proxy.example' : null,
      connect: transport.connect,
      fetch: jest.fn(async () => ({
        status: 200,
        json: async () => ({ signedUrl: 'wss://agent.example/session' }),
      })) as unknown as typeof fetch,
      appState: {
        get currentState() {
          return state;
        },
        addEventListener: (_event, callback) => {
          change = callback;
          return { remove: jest.fn() };
        },
      },
    });
    if (mode === 'online') {
      jest
        .mocked(audioLink().requestPermission)
        .mockImplementationOnce(async () => {
          await permission;
          return true;
        });
    } else {
      jest
        .mocked(speechInput().requestPermission)
        .mockImplementationOnce(async () => {
          await permission;
          return 'granted';
        });
    }
    runtime.start();
    const pack = fixturePack();
    const session = runtime.sessionFor(pack)!.session;
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
    state = 'background';
    change('background');
    expect(runtime.voiceSnapshot().foreground).toBe(true);
    state = 'active';
    change('active');
    allow();
    await jest.advanceTimersByTimeAsync(0);
    if (mode === 'online') {
      transport.current.onopen?.();
    }
    await started;
    expect(changed.listening.mock.calls.at(-1)).toEqual([true]);
    state = 'background';
    change('background');
    state = 'active';
    change('active');
    expect(changed.listening.mock.calls.at(-1)).toEqual([false]);
    expect(transport.open).toBe(0);
    runtime.stop();
  },
);

test('a microphone prompt that settles in the background ends the pending conversation', async () => {
  let state = 'active';
  let change!: (state: import('react-native').AppStateStatus) => void;
  let allow!: (permission: 'granted') => void;
  jest.mocked(speechInput().requestPermission).mockReturnValueOnce(
    new Promise(resolve => {
      allow = resolve;
    }),
  );
  const runtime = createInstructorRuntime({
    appEvents: createEventBus<AppEvents>(),
    proxyUrl: null,
    appState: {
      get currentState() {
        return state;
      },
      addEventListener: (_event, callback) => {
        change = callback;
        return { remove: () => {} };
      },
    },
  });
  runtime.start();
  const pack = fixturePack();
  const session = runtime.sessionFor(pack)!.session;
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
  state = 'background';
  change('background');
  expect(runtime.voiceSnapshot().foreground).toBe(true);
  allow('granted');
  await started;
  expect(runtime.voiceSnapshot().foreground).toBe(false);
  expect(changed.listening.mock.calls.at(-1)).toEqual([false]);
  expect(runtime.sessionFor(pack)).toBeNull();
  runtime.stop();
});

test('airplane mode prepares every offline piece and falls back to the script', async () => {
  const appEvents = createEventBus<AppEvents>();
  let path!: (value: NetworkPath) => void;
  const runtime = createInstructorRuntime({
    appEvents,
    appState: foregroundAppState,
    proxyUrl: 'https://proxy.example',
    networkMonitor: () => ({
      start: callback => {
        path = callback;
      },
      stop: jest.fn(),
    }),
    speechInput,
    speechOutput,
    fetch: jest.fn(async () => ({ status: 204 })) as unknown as typeof fetch,
  });
  runtime.setPack(fixturePack());
  runtime.start();
  path({
    satisfied: true,
    transport: 'wifi',
    expensive: false,
    constrained: false,
    downstreamKbps: -1,
    signalLevel: -1,
  });
  path({
    satisfied: false,
    transport: 'none',
    expensive: false,
    constrained: false,
    downstreamKbps: -1,
    signalLevel: -1,
  });
  expect(appEvents.latest('mode')?.mode).toBe('switchingToOffline');
  await jest.advanceTimersByTimeAsync(600);
  expect(appEvents.latest('mode')).toMatchObject({
    mode: 'offline',
    answers: 'script',
  });
  expect(appEvents.latest('switchStep')).toMatchObject({
    state: 'ready',
    piece: 'listening',
    label: SwitchLabel.deviceListening,
  });
  runtime.stop();
});

test.each([
  { platform: 'android', label: 'Voice: system voice', voice: 'system' },
  { platform: 'ios', label: 'Voice: Kokoro', voice: 'kokoro' },
] as const)(
  '$platform names and starts its available offline voice',
  async ({ platform, label, voice }) => {
    const originalPlatform = jest.replaceProperty(Platform, 'OS', platform);
    const appEvents = createEventBus<AppEvents>();
    let path!: (value: NetworkPath) => void;
    const steps: AppEvents['switchStep'][] = [];
    const unsubscribe = appEvents.on(AppEvent.switchStep, step =>
      steps.push(step),
    );
    const runtime = createInstructorRuntime({
      appEvents,
      appState: foregroundAppState,
      proxyUrl: 'https://proxy.example',
      networkMonitor: () => ({
        start: callback => {
          path = callback;
        },
        stop: () => {},
      }),
      fetch: jest.fn(async () => ({ status: 204 })) as unknown as typeof fetch,
    });
    try {
      runtime.start();
      const route = {
        satisfied: true,
        transport: 'wifi' as const,
        expensive: false,
        constrained: false,
        downstreamKbps: -1,
        signalLevel: -1,
      };
      path(route);
      path({ ...route, satisfied: false });
      expect(steps.find(step => step.piece === 'voice')).toMatchObject({
        state: 'starting',
        label,
      });
      await jest.advanceTimersByTimeAsync(600);
      expect(steps.filter(step => step.piece === 'voice')).toEqual([
        expect.objectContaining({ state: 'starting', label }),
        expect.objectContaining({ state: 'ready', label }),
      ]);
      const session = runtime.sessionFor(fixturePack())!.session;
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
      expect(speechOutput().speak).toHaveBeenCalledWith(
        'Offline.',
        'en-US',
        expect.any(Function),
        voice,
      );
      session.stop();
    } finally {
      runtime.stop();
      unsubscribe();
      originalPlatform.restore();
    }
  },
);

test('good network for ten seconds restores agent voice and reuses the prepared signed URL', async () => {
  const appEvents = createEventBus<AppEvents>();
  let path!: (value: NetworkPath) => void;
  const fetchImpl = jest.fn(async (address: unknown) =>
    String(address).endsWith('/v1/voice/session')
      ? {
          status: 200,
          json: async () => ({ signedUrl: 'wss://agent.example/session' }),
        }
      : { status: 204 },
  );
  const connect = jest.fn(() => ({
    send: jest.fn(),
    close: jest.fn(),
    onopen: null as (() => void) | null,
    onmessage: null,
    onerror: null,
    onclose: null,
  }));
  const runtime = createInstructorRuntime({
    appEvents,
    appState: foregroundAppState,
    proxyUrl: 'https://proxy.example',
    networkMonitor: () => ({
      start: callback => {
        path = callback;
      },
      stop: jest.fn(),
    }),
    fetch: fetchImpl as unknown as typeof fetch,
    connect,
  });
  const pack = fixturePack();
  runtime.setPack(pack);
  runtime.start();
  const route = {
    satisfied: true,
    transport: 'wifi' as const,
    expensive: false,
    constrained: false,
    downstreamKbps: -1,
    signalLevel: -1,
  };
  path(route);
  await jest.advanceTimersByTimeAsync(0);
  path({ ...route, satisfied: false });
  await jest.advanceTimersByTimeAsync(600);
  path(route);
  await jest.advanceTimersByTimeAsync(9999);
  expect(appEvents.latest('mode')?.mode).toBe('offline');
  await jest.advanceTimersByTimeAsync(1);
  expect(appEvents.latest('mode')?.mode).toBe('switchingToOnline');
  await jest.advanceTimersByTimeAsync(600);
  expect(appEvents.latest('mode')).toMatchObject({
    mode: 'online',
    voice: 'agent',
    answers: 'claude',
  });
  const session = runtime.sessionFor(pack)!.session;
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
  connect.mock.results[0].value.onopen?.();
  await started;
  expect(
    fetchImpl.mock.calls.filter(([address]) =>
      String(address).endsWith('/v1/voice/session'),
    ),
  ).toHaveLength(1);
  session.stop();
  runtime.stop();
  expect(jest.getTimerCount()).toBe(0);
});

test('quota keeps later conversations on device for the run and offline questions skip cloud requests', async () => {
  const appEvents = createEventBus<AppEvents>();
  let path!: (value: NetworkPath) => void;
  const Request = jest.fn();
  const fetchImpl = jest.fn(async (address: unknown) =>
    String(address).endsWith('/v1/voice/session')
      ? { status: 429, json: async () => ({ error: 'voice quota' }) }
      : { status: 204 },
  );
  const runtime = createInstructorRuntime({
    appEvents,
    appState: foregroundAppState,
    proxyUrl: 'https://proxy.example',
    networkMonitor: () => ({
      start: callback => {
        path = callback;
      },
      stop: jest.fn(),
    }),
    fetch: fetchImpl as unknown as typeof fetch,
    Request: Request as unknown as typeof XMLHttpRequest,
  });
  const pack = fixturePack();
  runtime.setPack(pack);
  runtime.start();
  const route = {
    satisfied: true,
    transport: 'wifi' as const,
    expensive: false,
    constrained: false,
    downstreamKbps: -1,
    signalLevel: -1,
  };
  path(route);
  await jest.advanceTimersByTimeAsync(0);
  const session = runtime.sessionFor(pack)!.session;
  await session.start(
    {
      pack,
      state: { procedureId: null, stepIndex: 0, selectedPart: null },
      history: [],
      thinking: false,
    },
    voiceEvents(),
  );
  expect(appEvents.latest('mode')).toMatchObject({
    mode: 'online',
    voice: 'device',
  });
  expect(appEvents.latest('agent')).toMatchObject({
    state: 'failed',
    reason: 'quota',
  });
  session.stop();
  expect(runtime.sessionFor(pack)?.questions).toBeNull();
  path({ ...route, satisfied: false });
  await jest.advanceTimersByTimeAsync(600);
  await runtime.instructor.ask(
    {
      question: 'Explain the battery',
      pack,
      state: { procedureId: null, stepIndex: 0, selectedPart: null },
      history: [],
    },
    jest.fn(),
  );
  expect(Request).not.toHaveBeenCalled();
  path(route);
  await jest.advanceTimersByTimeAsync(10600);
  expect(appEvents.latest('mode')).toMatchObject({
    mode: 'online',
    voice: 'device',
  });
  expect(
    fetchImpl.mock.calls.filter(([address]) =>
      String(address).endsWith('/v1/voice/session'),
    ),
  ).toHaveLength(1);
  runtime.stop();
});

test('backgrounding closes the conversation without reconnecting', async () => {
  const appEvents = createEventBus<AppEvents>();
  let background!: (state: import('react-native').AppStateStatus) => void;
  const transport = fakeAgentTransport();
  const fetchImpl = jest.fn(async () => ({
    status: 200,
    json: async () => ({ signedUrl: 'wss://agent.example/session' }),
  }));
  const runtime = createInstructorRuntime({
    appEvents,
    proxyUrl: 'https://proxy.example',
    connect: transport.connect,
    fetch: fetchImpl as unknown as typeof fetch,
    appState: {
      currentState: 'active',
      addEventListener: (_event, callback) => {
        background = callback;
        return { remove: jest.fn() };
      },
    },
  });
  runtime.start();
  const pack = fixturePack();
  const session = runtime.sessionFor(pack)!.session;
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
  transport.current.onopen?.();
  await started;
  background('background');
  expect(changed.listening.mock.calls.at(-1)).toEqual([false]);
  expect(transport.open).toBe(0);
  await jest.advanceTimersByTimeAsync(30000);
  expect(transport.open).toBe(0);
  runtime.stop();
});

test('active quota marks the agent unavailable and keeps this conversation and the next on device', async () => {
  const appEvents = createEventBus<AppEvents>();
  const transport = fakeAgentTransport();
  const runtime = createInstructorRuntime({
    appEvents,
    appState: foregroundAppState,
    proxyUrl: 'https://proxy.example',
    connect: transport.connect,
    fetch: jest.fn(async () => ({
      status: 200,
      json: async () => ({ signedUrl: 'wss://agent.example/session' }),
    })) as unknown as typeof fetch,
  });
  const pack = fixturePack();
  const context = {
    pack,
    state: { procedureId: null, stepIndex: 0, selectedPart: null },
    history: [],
    thinking: false,
  };
  runtime.start();
  const voice = runtime.sessionFor(pack)!;
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
  transport.current.onopen?.();
  await started;
  voice.questions!.ask('Why check the battery?');
  transport.current.onclose?.({ code: 1000, reason: 'quota exceeded' });
  await jest.advanceTimersByTimeAsync(0);
  expect(appEvents.latest(AppEvent.agent)).toEqual({
    state: AgentState.failed,
    reason: ConnectionFailure.quota,
  });
  expect(appEvents.latest(AppEvent.mode)?.voice).toBe(VoiceSource.device);
  expect(questions).toEqual(['Why check the battery?']);
  expect(speechOutput().speak).toHaveBeenCalledWith(
    'Check the battery terminals.',
    VOICE_LOCALE,
    expect.any(Function),
    SpeechVoice.system,
  );
  expect(voice.questions).toBeNull();
  expect(transport.open).toBe(0);
  voice.session.stop();
  const next = runtime.sessionFor(pack)!;
  await next.session.start(context, voiceEvents());
  expect(next.questions).toBeNull();
  expect(transport.connections).toBe(1);
  next.session.stop();
  runtime.stop();
});
