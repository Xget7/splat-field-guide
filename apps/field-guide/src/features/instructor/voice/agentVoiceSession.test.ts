import { speechInput } from 'react-native-on-device';
import { voiceEvents as events } from '../../../testing/voiceSession';
import { SpeechPermission } from './voiceCopy';
import { VoiceStartFailure } from './voiceSession';
import { fixturePack } from '../../../testing/fixturePack';
import { INITIAL_SESSION } from '../../guide/session';
import {
  createAgentVoiceSession,
  type SessionAgentHandlers,
} from './agentVoiceSession';

const pack = fixturePack();
const client = () => ({
  start: jest.fn(async () => {}),
  sendText: jest.fn(),
  sendContext: jest.fn(),
  setMuted: jest.fn(),
  interrupt: jest.fn(),
  stop: jest.fn(),
});

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

test('requests access before starting agent audio and rejects denied access without opening a client', async () => {
  const input = speechInput();
  const permissionRequests = jest.mocked(input.requestPermission).mock.calls
    .length;
  let grant!: (
    permission: Awaited<ReturnType<typeof input.requestPermission>>,
  ) => void;
  jest.mocked(input.requestPermission).mockReturnValueOnce(
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
  grant(SpeechPermission.granted);
  await started;
  expect(transport.start).toHaveBeenCalled();
  expect(
    jest.mocked(input.requestPermission).mock.calls.length - permissionRequests,
  ).toBe(1);
  session.stop();
  jest.mocked(input.requestPermission).mockResolvedValueOnce('denied');
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
