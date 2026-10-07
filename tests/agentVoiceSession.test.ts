import { audioLink, speechInput } from 'react-native-on-device';
import { voiceEvents as events } from './voiceSession';
import { SpeechPermission } from '../apps/field-guide/src/features/instructor/voice/voiceCopy';
import { VoiceStartFailure } from '../apps/field-guide/src/features/instructor/voice/voiceSession';
import { fixturePack } from './fixturePack';
import { INITIAL_SESSION } from '../apps/field-guide/src/features/guide/session';
import {
  createAgentVoiceSession,
  type SessionAgentHandlers,
} from '../apps/field-guide/src/features/instructor/voice/agentVoiceSession';

const pack = fixturePack();
const client = () => ({
  start: jest.fn(async () => {}),
  sendText: jest.fn(),
  sendContext: jest.fn(),
  setMuted: jest.fn(),
  interrupt: jest.fn(),
  stop: jest.fn(),
});

test.each([false, true])(
  'listening waits for permission and connection, with startup mute: %s',
  async muted => {
    let grant!: (allowed: boolean) => void;
    let connect!: () => void;
    let connecting!: () => void;
    const connectionStarted = new Promise<void>(resolve => {
      connecting = resolve;
    });
    const transport = client();
    transport.start.mockImplementationOnce(async () => {
      connecting();
      await new Promise<void>(resolve => {
        connect = resolve;
      });
    });
    const changed = events();
    const session = createAgentVoiceSession({
      pack,
      client: () => transport,
      audio: () => ({
        requestPermission: () =>
          new Promise<boolean>(resolve => {
            grant = resolve;
          }),
      }),
    });
    const starting = session.start(
      { pack, state: INITIAL_SESSION, history: [], thinking: false },
      changed,
    );
    session.setMuted(false);
    expect(changed.listening).not.toHaveBeenCalled();
    grant(true);
    await connectionStarted;
    session.setMuted(muted);
    expect(changed.listening).not.toHaveBeenCalled();
    connect();
    await starting;
    expect(changed.listening.mock.calls).toEqual([[!muted]]);
    expect(transport.setMuted).toHaveBeenLastCalledWith(muted);
    session.setMuted(!muted);
    expect(changed.listening).toHaveBeenLastCalledWith(muted);
    session.stop();
  },
);

test('streams an exchange and retains a corrected interrupted answer', async () => {
  let heard!: SessionAgentHandlers;
  const transport = client();
  const changed = events();
  const session = createAgentVoiceSession({
    pack,
    client: handlers => {
      heard = handlers;
      return transport;
    },
  });
  await session.start(
    { pack, state: INITIAL_SESSION, history: [], thinking: false },
    changed,
  );
  heard.userTranscript('What does the battery do?');
  heard.responseText('It supplies');
  heard.response('It supplies the starter.');
  expect(changed.turn.mock.calls.map(([event]) => event.type)).toEqual([
    'begin',
    'partial',
    'answer',
  ]);
  heard.correction('It supplies');
  expect(changed.turn.mock.calls.at(-1)?.[0].exchange).toMatchObject({
    reply: 'It supplies',
    interrupted: true,
    phase: 'done',
  });
});

test('tool navigation is applied without repeating its narration and typed echoes do not duplicate exchanges', async () => {
  let heard!: SessionAgentHandlers;
  const transport = client();
  const changed = events();
  const session = createAgentVoiceSession({
    pack,
    client: handlers => {
      heard = handlers;
      return transport;
    },
  });
  await session.start(
    {
      pack,
      state: { procedureId: 'check-coolant', stepIndex: 0, selectedPart: null },
      history: [],
      thinking: false,
    },
    changed,
  );
  expect(session.ask('Next step')).toBe(true);
  heard.userTranscript('next step!');
  expect(changed.turn).toHaveBeenCalledTimes(1);
  const result = heard.toolCall('next_step', {});
  expect(result).toEqual({
    isError: false,
    result: 'Step 2 of 3 in Check the coolant level: Step locate',
  });
  expect(changed.action).toHaveBeenCalledWith({ type: 'next' });
  transport.sendText.mockClear();
  await session.say({
    id: 'step:1',
    kind: 'step',
    reply: 'Step locate',
    caution: '',
    stepKey: 'check-coolant:1:null',
  });
  await session.say({
    id: 'answer',
    kind: 'answer',
    reply: 'Already spoken.',
    caution: '',
    stepKey: null,
  });
  expect(transport.sendText).not.toHaveBeenCalled();
  await session.say({
    id: 'step:2',
    kind: 'step',
    reply: 'Read the level.',
    caution: 'Engine cold.',
    stepKey: 'check-coolant:2:null',
  });
  expect(transport.sendText.mock.calls).toEqual([
    ['[narrate] Read the level. Engine cold.'],
  ]);
  expect(transport.interrupt).not.toHaveBeenCalled();
});

test.each([
  ['', 'cancel', 'Why?'],
  ['The battery', 'answer', null],
])(
  'a network end retains reply %j or reports its unanswered question',
  async (reply, type, pending) => {
    let heard!: SessionAgentHandlers;
    const changed = events();
    const session = createAgentVoiceSession({
      pack,
      client: handlers => {
        heard = handlers;
        return client();
      },
    });
    await session.start(
      { pack, state: INITIAL_SESSION, history: [], thinking: false },
      changed,
    );
    heard.response('Opening narration');
    expect(changed.turn).not.toHaveBeenCalled();
    heard.userTranscript('Why?');
    if (reply !== '') {
      heard.responseText(reply);
    }
    heard.ended('network');
    expect(changed.turn.mock.calls.at(-1)?.[0]).toMatchObject({
      type,
      ...(reply !== ''
        ? { exchange: { reply, interrupted: true, phase: 'done' } }
        : {}),
    });
    expect(changed.ended).toHaveBeenCalledWith('network', pending);
  },
);

test('requests only microphone access before starting agent audio and rejects denied access without opening a client', async () => {
  const audio = audioLink();
  jest.mocked(speechInput().requestPermission).mockResolvedValueOnce('denied');
  let grant!: (permission: boolean) => void;
  jest.mocked(audio.requestPermission).mockReturnValueOnce(
    new Promise(resolve => {
      grant = resolve;
    }),
  );
  const transport = client();
  const makeClient = jest.fn(() => transport);
  const session = createAgentVoiceSession({ pack, client: makeClient });
  const started = session.start(
    { pack, state: INITIAL_SESSION, history: [], thinking: false },
    events(),
  );
  expect(makeClient).not.toHaveBeenCalled();
  grant(true);
  await started;
  expect(transport.start).toHaveBeenCalled();
  expect(speechInput().requestPermission).not.toHaveBeenCalled();
  session.stop();
  jest
    .mocked(speechInput().requestPermission)
    .mockReset()
    .mockResolvedValue(SpeechPermission.granted);
  jest.mocked(audio.requestPermission).mockResolvedValueOnce(false);
  makeClient.mockClear();
  await expect(
    session.start(
      { pack, state: INITIAL_SESSION, history: [], thinking: false },
      events(),
    ),
  ).rejects.toMatchObject({ failure: VoiceStartFailure.permission });
  expect(makeClient).not.toHaveBeenCalled();
});

test.each([false, true])(
  'a correction after the next transcript updates the old exchange, completed: %s',
  async completed => {
    let heard!: SessionAgentHandlers;
    const changed = events();
    const session = createAgentVoiceSession({
      pack,
      client: handlers => {
        heard = handlers;
        return client();
      },
    });
    await session.start(
      { pack, state: INITIAL_SESSION, history: [], thinking: false },
      changed,
    );
    heard.userTranscript('What does the battery do?');
    heard.responseText('It supplies the starter and');
    if (completed) {
      heard.response('It supplies the starter and lights.');
    }
    const first = changed.turn.mock.calls[0][0].exchange.id;
    heard.userTranscript('How do I check it?');
    const next = changed.turn.mock.calls.at(-1)![0].exchange.id;
    heard.correction('It supplies the starter.');
    expect(changed.turn.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'answer',
      exchange: {
        id: first,
        reply: 'It supplies the starter.',
        interrupted: true,
      },
    });
    heard.response('Check the terminals.');
    expect(changed.turn.mock.calls.at(-1)?.[0]).toMatchObject({
      exchange: { id: next, reply: 'Check the terminals.' },
    });
  },
);
