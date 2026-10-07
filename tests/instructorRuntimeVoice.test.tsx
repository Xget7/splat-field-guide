import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text, type AppStateStatus } from 'react-native';
import {
  speechInput,
  speechOutput,
  type NetworkPath,
} from 'react-native-on-device';
import { createInstructorRuntime } from '../apps/field-guide/src/app/instructorRuntime';
import { fakeAgentTransport } from './agentTransport';
import { foregroundAppState } from './voiceSession';
import { fixturePack } from './fixturePack';
import {
  appEvents,
  createEventBus,
} from '../apps/field-guide/src/features/events/bus';
import {
  AppEvent,
  InstructorMode,
  type AppEvents,
} from '../apps/field-guide/src/features/events/types';
import { INITIAL_SESSION } from '../apps/field-guide/src/features/guide/session';
import {
  useInstructorVoice,
  type InstructorVoice,
} from '../apps/field-guide/src/features/instructor/voice/useInstructorVoice';
import type { VoiceRuntime } from '../apps/field-guide/src/features/instructor/voice/voiceSession';
import { ModeArea } from '../apps/field-guide/src/screens/viewer/instructor/ModeArea';
import { voiceEvents } from './voiceSession';
import {
  SpeechVoice,
  VOICE_LOCALE,
} from '../apps/field-guide/src/features/instructor/voice/voiceCopy';
const context = {
  pack: fixturePack(),
  state: INITIAL_SESSION,
  history: [],
  thinking: false,
};

test.each([
  'signed URL network failure',
  'signed URL 404',
  'socket open failure',
  'failed reconnect',
])(
  '%s shows the device voice notice until a later agent conversation opens',
  async failure => {
    jest.useFakeTimers();
    const transport = fakeAgentTransport();
    let path!: (value: NetworkPath) => void;
    let firstRequest = true;
    const fetchImpl = jest.fn(async (address: unknown) => {
      if (String(address).endsWith('/v1/ping')) {
        return { status: 204 };
      }
      if (firstRequest) {
        firstRequest = false;
        if (failure === 'signed URL network failure') {
          throw new Error('network');
        }
        if (failure === 'signed URL 404') {
          return { status: 404, json: async () => ({}) };
        }
      }
      return {
        status: 200,
        json: async () => ({ signedUrl: 'wss://agent.example/session' }),
      };
    });
    const runtime = createInstructorRuntime({
      appEvents,
      appState: foregroundAppState,
      proxyUrl: 'https://proxy.example',
      connect: transport.connect,
      networkMonitor: () => ({
        start: callback => {
          path = callback;
        },
        stop: () => {},
      }),
      fetch: fetchImpl as unknown as typeof fetch,
    });
    let renderer!: Renderer.ReactTestRenderer;
    const text = () =>
      renderer.root.findAllByType(Text).map(node => node.props.children);
    try {
      await act(async () => {
        runtime.start();
        renderer = Renderer.create(<ModeArea />);
      });
      const fallback = runtime.sessionFor(context.pack)!;
      await act(async () => {
        const started = fallback.session.start(context, voiceEvents());
        await jest.advanceTimersByTimeAsync(0);
        if (failure === 'socket open failure') {
          transport.current.onerror?.();
          await jest.advanceTimersByTimeAsync(0);
        } else if (failure === 'failed reconnect') {
          transport.ready();
          await started;
          transport.current.onerror?.();
          await jest.advanceTimersByTimeAsync(0);
          transport.current.onerror?.();
          await jest.advanceTimersByTimeAsync(0);
        }
        await started;
      });
      await fallback.session.say({
        id: 'battery-answer',
        kind: 'answer',
        reply: 'Check the battery terminals.',
        caution: '',
        stepKey: null,
      });
      expect(speechOutput().speak).toHaveBeenCalledWith(
        'Check the battery terminals.',
        VOICE_LOCALE,
        expect.any(Function),
        SpeechVoice.system,
      );
      expect(appEvents.latest(AppEvent.mode)).toMatchObject({
        mode: 'online',
        voice: 'device',
      });
      expect(text()).toEqual([
        'Online voice unavailable',
        'Using on-device voice.',
      ]);
      await act(async () =>
        path({
          satisfied: true,
          transport: 'wifi',
          expensive: false,
          constrained: false,
          downstreamKbps: -1,
          signalLevel: -1,
        }),
      );
      expect(text()).toContain('Online voice unavailable');
      fallback.session.stop();
      const next = runtime.sessionFor(context.pack)!;
      await act(async () => {
        const started = next.session.start(context, voiceEvents());
        await jest.advanceTimersByTimeAsync(0);
        transport.ready();
        await started;
      });
      expect(appEvents.latest(AppEvent.mode)?.voice).toBe('agent');
      expect(next.questions).not.toBeNull();
      expect(renderer.toJSON()).toBeNull();
      next.session.stop();
    } finally {
      await act(async () => renderer?.unmount());
      runtime.stop();
      jest.useRealTimers();
    }
  },
);

function harness(runtime: VoiceRuntime, onAsk = jest.fn()) {
  let voice!: InstructorVoice;
  function Harness({ enabled = true }: { enabled?: boolean }) {
    voice = useInstructorVoice({
      pack: context.pack,
      context,
      enabled,
      utterance: null,
      runtime,
      onAsk,
      onCancel: jest.fn(),
      onTurn: jest.fn(),
      onAction: jest.fn(),
      onIdle: jest.fn(),
      startInVoice: true,
    });
    return null;
  }
  return {
    Harness,
    get voice() {
      return voice;
    },
  };
}

test('an offline switch never installs speech assets, but the next Voice tap may open the model prompt', async () => {
  jest.useFakeTimers();
  const transport = fakeAgentTransport();
  const bus = createEventBus<AppEvents>();
  let state: AppStateStatus = 'active';
  let change!: (state: AppStateStatus) => void;
  let path!: (value: NetworkPath) => void;
  const runtime = createInstructorRuntime({
    appEvents: bus,
    networkMonitor: () => ({
      start: callback => {
        path = callback;
      },
      stop: () => {},
    }),
    appState: {
      get currentState() {
        return state;
      },
      addEventListener: (_event, callback) => {
        change = callback;
        return { remove: () => {} };
      },
    },
    proxyUrl: 'https://proxy.example',
    connect: transport.connect,
    fetch: jest.fn(async () => ({
      status: 200,
      json: async () => ({ signedUrl: 'wss://agent.example/session' }),
    })) as unknown as typeof fetch,
  });
  const h = harness(runtime);
  let renderer!: Renderer.ReactTestRenderer;
  try {
    runtime.start();
    path({
      satisfied: true,
      transport: 'wifi',
      expensive: false,
      constrained: false,
      downstreamKbps: -1,
      signalLevel: -1,
    });
    await act(async () => {
      renderer = Renderer.create(<h.Harness />);
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
      transport.ready();
    });
    expect(h.voice.open).toBe(true);
    jest.mocked(speechInput().prepare).mockResolvedValue('unavailable');
    await act(async () =>
      bus.emit(AppEvent.modeRequest, { type: 'acceptSuggestion' }),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(600);
    });
    expect(bus.latest(AppEvent.mode)?.mode).toBe('offline');
    expect(speechInput().install).not.toHaveBeenCalled();
    expect(h.voice.on).toBe(false);
    expect(h.voice.hint).toBe(
      'On-device speech recognition is unavailable. You can still type.',
    );
    jest.mocked(speechInput().install).mockImplementationOnce(async () => {
      state = 'background';
      change(state);
      expect(runtime.voiceSnapshot().foreground).toBe(true);
      state = 'active';
      change(state);
      return 'available';
    });
    await act(async () => h.voice.toggle());
    expect(speechInput().install).toHaveBeenCalledTimes(1);
    expect(h.voice.on).toBe(true);
    expect(h.voice.open).toBe(true);
  } finally {
    jest.mocked(speechInput().prepare).mockResolvedValue('available');
    await act(async () => renderer?.unmount());
    runtime.stop();
    jest.useRealTimers();
  }
});

test.each(['active', 'inactive'])(
  'an initially %s conversation survives inactive, but background leaves voice off on return',
  async initialState => {
    jest.useFakeTimers();
    const transport = fakeAgentTransport();
    let changeState!: (state: AppStateStatus) => void;
    const runtime = createInstructorRuntime({
      appEvents: createEventBus<AppEvents>(),
      appState: {
        currentState: initialState,
        addEventListener: (_event, listener) => {
          changeState = listener;
          return { remove: () => {} };
        },
      },
      proxyUrl: 'https://proxy.example',
      connect: transport.connect,
      fetch: jest.fn(async () => ({
        status: 200,
        json: async () => ({ signedUrl: 'wss://agent.example/session' }),
      })) as unknown as typeof fetch,
    });
    runtime.start();
    const h = harness(runtime);
    let renderer!: Renderer.ReactTestRenderer;
    await act(async () => {
      renderer = Renderer.create(<h.Harness />);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
      transport.ready();
    });
    expect(h.voice.open).toBe(true);
    const conversation = transport.current;
    await act(async () => changeState('inactive'));
    expect(h.voice.on).toBe(true);
    expect(h.voice.open).toBe(true);
    await act(async () => changeState('active'));
    expect(h.voice.open).toBe(true);
    expect(transport.current).toBe(conversation);
    expect(transport.open).toBe(1);
    await act(async () => changeState('background'));
    expect(h.voice.on).toBe(false);
    expect(h.voice.open).toBe(false);
    expect(transport.open).toBe(0);
    await act(async () => {
      changeState('active');
      await jest.advanceTimersByTimeAsync(30000);
    });
    expect(h.voice.on).toBe(false);
    expect(h.voice.open).toBe(false);
    expect(transport.open).toBe(0);
    await act(async () => h.voice.toggle());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
      transport.ready();
    });
    expect(h.voice.open).toBe(true);
    await act(async () => renderer.unmount());
    runtime.stop();
    jest.useRealTimers();
  },
);

test('a socket failure before the offline event carries the waiting question through device startup and the switch', async () => {
  jest.useFakeTimers();
  const transport = fakeAgentTransport();
  const bus = createEventBus<AppEvents>();
  let path!: (value: NetworkPath) => void;
  const runtime = createInstructorRuntime({
    appEvents: bus,
    appState: foregroundAppState,
    proxyUrl: 'https://proxy.example',
    connect: transport.connect,
    networkMonitor: () => ({
      start: callback => {
        path = callback;
      },
      stop: () => {},
    }),
    fetch: jest.fn(async (address: unknown) =>
      String(address).endsWith('/v1/voice/session')
        ? {
            status: 200,
            json: async () => ({ signedUrl: 'wss://agent.example/session' }),
          }
        : { status: 204 },
    ) as unknown as typeof fetch,
  });
  runtime.setPack(context.pack);
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
  const questions: string[] = [];
  const h = harness(
    runtime,
    jest.fn(question => questions.push(question)),
  );
  let renderer!: Renderer.ReactTestRenderer;
  await act(async () => {
    renderer = Renderer.create(<h.Harness />);
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
    transport.ready();
  });
  await act(async () => {
    h.voice.ask('Why check the battery?');
    transport.current.onerror?.();
    await jest.advanceTimersByTimeAsync(0);
    transport.current.onerror?.();
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(questions).toEqual(['Why check the battery?']);
  expect(h.voice.open).toBe(true);
  await act(async () => path({ ...route, satisfied: false }));
  expect(bus.latest(AppEvent.mode)?.mode).toBe(
    InstructorMode.switchingToOffline,
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });
  expect(bus.latest(AppEvent.mode)?.mode).toBe(InstructorMode.offline);
  expect(questions).toEqual([
    'Why check the battery?',
    'Why check the battery?',
  ]);
  expect(h.voice.on).toBe(true);
  expect(h.voice.open).toBe(true);
  expect(transport.open).toBe(0);
  await act(async () => renderer.update(<h.Harness />));
  expect(questions).toEqual([
    'Why check the battery?',
    'Why check the battery?',
  ]);
  await act(async () => renderer.unmount());
  runtime.stop();
  jest.useRealTimers();
});
