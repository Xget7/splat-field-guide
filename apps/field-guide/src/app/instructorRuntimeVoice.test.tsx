import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import type { AppStateStatus } from 'react-native';
import type { NetworkPath } from 'react-native-on-device';
import { createInstructorRuntime } from './instructorRuntime';
import { fakeAgentTransport } from '../testing/agentTransport';
import { foregroundAppState } from '../testing/voiceSession';
import { fixturePack } from '../testing/fixturePack';
import { createEventBus } from '../features/events/bus';
import {
  AppEvent,
  InstructorMode,
  type AppEvents,
} from '../features/events/types';
import { INITIAL_SESSION } from '../features/guide/session';
import {
  useInstructorVoice,
  type InstructorVoice,
} from '../features/instructor/voice/useInstructorVoice';
import type { VoiceRuntime } from '../features/instructor/voice/voiceSession';
const context = {
  pack: fixturePack(),
  state: INITIAL_SESSION,
  history: [],
  thinking: false,
};

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
      transport.current?.onopen?.();
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
      transport.current.onopen?.();
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
    transport.current.onopen?.();
  });
  await act(async () => {
    h.voice.ask('Why check the battery?');
    transport.current.onerror?.();
    await jest.advanceTimersByTimeAsync(0);
    transport.current.onerror?.();
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
