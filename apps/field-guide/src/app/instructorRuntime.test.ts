import { speechInput, speechOutput } from 'react-native-on-device';
import { createEventBus } from '../features/events/bus';
import type { AppEvents } from '../features/events/types';
import { fixturePack } from '../testing/fixturePack';
import { createInstructorRuntime } from './instructorRuntime';
import type { NetworkPath } from 'react-native-on-device';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('airplane mode prepares every offline piece and falls back to the script', async () => {
  const appEvents = createEventBus<AppEvents>();
  let path!: (value: NetworkPath) => void;
  const runtime = createInstructorRuntime({
    appEvents,
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
  });
  runtime.stop();
});

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
  const session = runtime.sessionFor(appEvents.latest('mode')!, pack);
  const started = session.start(
    {
      pack,
      state: { procedureId: null, stepIndex: 0, selectedPart: null },
      history: [],
      thinking: false,
    },
    {
      listening: jest.fn(),
      transcript: jest.fn(),
      speaking: jest.fn(),
      word: jest.fn(),
      level: jest.fn(),
      hint: jest.fn(),
      question: jest.fn(),
      cancelQuestion: jest.fn(),
      turn: jest.fn(),
      action: jest.fn(),
      ended: jest.fn(),
    },
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
  const status = appEvents.latest('mode')!;
  const session = runtime.sessionFor(status, pack);
  await session.start(
    {
      pack,
      state: { procedureId: null, stepIndex: 0, selectedPart: null },
      history: [],
      thinking: false,
    },
    {
      listening: jest.fn(),
      transcript: jest.fn(),
      speaking: jest.fn(),
      word: jest.fn(),
      level: jest.fn(),
      hint: jest.fn(),
      question: jest.fn(),
      cancelQuestion: jest.fn(),
      turn: jest.fn(),
      action: jest.fn(),
      ended: jest.fn(),
    },
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
  expect(runtime.sessionFor(status, pack).kind).toBe('pipeline');
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
