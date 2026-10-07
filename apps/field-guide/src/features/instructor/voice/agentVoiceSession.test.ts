import { fixturePack } from '../../../testing/fixturePack';
import { INITIAL_SESSION } from '../../guide/session';
import {
  createAgentVoiceSession,
  type SessionAgentHandlers,
} from './agentVoiceSession';

const pack = fixturePack();
const events = () => ({
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
});
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
