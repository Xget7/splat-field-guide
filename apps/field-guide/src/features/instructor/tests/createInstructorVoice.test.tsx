import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text, type AppStateStatus } from 'react-native';
import { createInstructor } from '../createInstructor';
import { OfflineVoices } from '../domain/mode/modeSwitching';
import { fakePlatform } from '@tests/platform';
import { fixturePack } from '@tests/fixturePack';
import { ProxyPath } from '../data/proxy/proxyContract';
import { instructorStore } from '../state/instructorStore';
import type { Fetch, Platform } from '../../../platform/ports';
import type { PathInfo } from '../../../platform/connectivity/networkQuality';
import { InstructorMode } from '../domain/mode/modeTypes';
import { INITIAL_SESSION } from '../../guide';
import {
  useInstructorVoice,
  type InstructorVoice,
} from '../ui/useInstructorVoice';
import type { VoiceRuntime } from '../domain/voice/voiceSession';
import { ModeArea } from '../ui/ModeArea';
import { voiceEvents } from '@tests/voiceSession';
import { SpeechVoice, VOICE_LOCALE } from '../domain/voice/voiceCopy';
const context = {
  pack: fixturePack(),
  state: INITIAL_SESSION,
  history: [],
  thinking: false,
};
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
const signedUrlOrPing = async (address: unknown) =>
  String(address).endsWith(ProxyPath.voiceSession)
    ? signedUrl()
    : { status: 204 };

/**
 * Builds the proxied instructor over a fake platform, speaking offline with Kokoro as on iOS. It
 * reports to the app-wide store, which the mode area and the voice hook read.
 */
function instructorOn(platform: Platform) {
  return createInstructor({
    platform,
    proxyUrl: PROXY_URL,
    offlineVoice: OfflineVoices.kokoro,
    store: instructorStore,
  });
}

beforeEach(() => instructorStore.getState().reset());

test.each([
  'signed URL network failure',
  'signed URL 404',
  'socket open failure',
  'failed reconnect',
])(
  '%s shows the device voice notice until a later agent conversation opens',
  async failure => {
    jest.useFakeTimers();
    let firstRequest = true;
    const fetchImpl = jest.fn(async (address: unknown) => {
      if (String(address).endsWith(ProxyPath.ping)) {
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
      return signedUrl();
    });
    const fake = fakePlatform({ fetch: fetchImpl as unknown as Fetch });
    const { transport } = fake;
    const instructor = instructorOn(fake.platform);
    let renderer!: Renderer.ReactTestRenderer;
    const text = () =>
      renderer.root.findAllByType(Text).map(node => node.props.children);
    try {
      await act(async () => {
        instructor.start();
        renderer = Renderer.create(<ModeArea />);
      });
      const fallback = instructor.sessionFor(context.pack)!;
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
      expect(fake.output.speak).toHaveBeenCalledWith(
        'Check the battery terminals.',
        VOICE_LOCALE,
        expect.any(Function),
        SpeechVoice.system,
      );
      expect(instructorStore.getState().mode).toMatchObject({
        mode: 'online',
        voice: 'device',
      });
      expect(text()).toEqual([
        'Online voice unavailable',
        'Using on-device voice.',
      ]);
      await act(async () => fake.network.emit(WIFI));
      expect(text()).toContain('Online voice unavailable');
      fallback.session.stop();
      const next = instructor.sessionFor(context.pack)!;
      await act(async () => {
        const started = next.session.start(context, voiceEvents());
        await jest.advanceTimersByTimeAsync(0);
        transport.ready();
        await started;
      });
      expect(instructorStore.getState().mode.voice).toBe('agent');
      expect(next.questions).not.toBeNull();
      expect(renderer.toJSON()).toBeNull();
      next.session.stop();
    } finally {
      await act(async () => renderer?.unmount());
      instructor.stop();
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
  const fake = fakePlatform({
    fetch: jest.fn(signedUrl) as unknown as Fetch,
  });
  const { transport, input } = fake;
  const instructor = instructorOn(fake.platform);
  const h = harness(instructor);
  let renderer!: Renderer.ReactTestRenderer;
  try {
    instructor.start();
    fake.network.emit(WIFI);
    await act(async () => {
      renderer = Renderer.create(<h.Harness />);
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
      transport.ready();
    });
    expect(h.voice.open).toBe(true);
    input.prepare.mockResolvedValue('unavailable');
    instructorStore.getState().attach(instructor);
    await act(async () => instructorStore.getState().acceptSuggestion());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(600);
    });
    expect(instructorStore.getState().mode.mode).toBe('offline');
    expect(input.install).not.toHaveBeenCalled();
    expect(h.voice.on).toBe(false);
    expect(h.voice.hint).toBe(
      'On-device speech recognition is unavailable. You can still type.',
    );
    input.install.mockImplementationOnce(async () => {
      fake.appState.change('background');
      expect(instructorStore.getState().voice.foreground).toBe(true);
      fake.appState.change('active');
      return 'available';
    });
    await act(async () => h.voice.toggle());
    expect(input.install).toHaveBeenCalledTimes(1);
    expect(h.voice.on).toBe(true);
    expect(h.voice.open).toBe(true);
  } finally {
    await act(async () => renderer?.unmount());
    instructor.stop();
    jest.useRealTimers();
  }
});

test.each<AppStateStatus>(['active', 'inactive'])(
  'an initially %s conversation survives inactive, but background leaves voice off on return',
  async initialState => {
    jest.useFakeTimers();
    const fake = fakePlatform({
      initialAppState: initialState,
      fetch: jest.fn(signedUrl) as unknown as Fetch,
    });
    const { transport } = fake;
    const changeState = fake.appState.change;
    const instructor = instructorOn(fake.platform);
    instructor.start();
    const h = harness(instructor);
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
    instructor.stop();
    jest.useRealTimers();
  },
);

test('a socket failure before the offline event carries the waiting question through device startup and the switch', async () => {
  jest.useFakeTimers();
  const fake = fakePlatform({
    fetch: jest.fn(signedUrlOrPing) as unknown as Fetch,
  });
  const { transport } = fake;
  const instructor = instructorOn(fake.platform);
  instructor.setPack(context.pack);
  instructor.start();
  fake.network.emit(WIFI);
  const questions: string[] = [];
  const h = harness(
    instructor,
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
  await act(async () => fake.network.emit({ ...WIFI, satisfied: false }));
  expect(instructorStore.getState().mode.mode).toBe(
    InstructorMode.switchingToOffline,
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });
  expect(instructorStore.getState().mode.mode).toBe(InstructorMode.offline);
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
  instructor.stop();
  jest.useRealTimers();
});

test('a conversation that fell back to the device voice reconnects to the agent on a new route', async () => {
  jest.useFakeTimers();
  const fake = fakePlatform({
    fetch: jest.fn(signedUrlOrPing) as unknown as Fetch,
  });
  const { transport } = fake;
  const instructor = instructorOn(fake.platform);
  instructor.setPack(context.pack);
  instructor.start();
  fake.network.emit(WIFI);
  const h = harness(instructor);
  let renderer!: Renderer.ReactTestRenderer;
  await act(async () => {
    renderer = Renderer.create(<h.Harness />);
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
    transport.ready();
  });
  await act(async () => {
    transport.current.onerror?.();
    await jest.advanceTimersByTimeAsync(0);
    transport.current.onerror?.();
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(instructorStore.getState().mode.voice).toBe('device');
  const connections = transport.connections;
  await act(async () => {
    fake.network.emit({ ...WIFI, transport: 'cellular' });
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(transport.connections).toBe(connections + 1);
  await act(async () => transport.ready());
  expect(instructorStore.getState().mode).toMatchObject({
    mode: InstructorMode.online,
    voice: 'agent',
  });
  expect(h.voice.on).toBe(true);
  await act(async () => renderer.unmount());
  instructor.stop();
  jest.useRealTimers();
});
