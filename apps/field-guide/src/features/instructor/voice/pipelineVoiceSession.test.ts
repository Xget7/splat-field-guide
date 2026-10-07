import { speechInput, speechOutput } from 'react-native-on-device';
import { fixturePack } from '../../../testing/fixturePack';
import { INITIAL_SESSION } from '../../guide/session';
import { createPipelineVoiceSession } from './pipelineVoiceSession';

const context = {
  pack: fixturePack(),
  state: INITIAL_SESSION,
  history: [],
  thinking: false,
};
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

test('settles a spoken question and ignores callbacks after stopping', async () => {
  const changed = events();
  const session = createPipelineVoiceSession({
    voice: 'system',
    hints: ['Battery'],
  });
  await session.start(context, changed);
  const [, hints, , turn] = jest
    .mocked(speechInput().listen)
    .mock.calls.at(-1)!;
  expect(hints).toEqual(['Battery']);
  turn('Where is the battery?');
  expect(changed.question).toHaveBeenCalledWith('Where is the battery?');
  session.stop();
  turn('next');
  expect(changed.question).toHaveBeenCalledTimes(1);
  expect(changed.ended).not.toHaveBeenCalled();
  expect(speechOutput().stop).toHaveBeenCalled();
});

test('filters echo and noise, joins an unfinished question and cancels a stale answer on continuation', async () => {
  jest.useFakeTimers();
  const changed = events();
  const session = createPipelineVoiceSession({ voice: 'kokoro', hints: [] });
  await session.start(context, changed);
  const [, , partial, turn, , voice] = jest
    .mocked(speechInput().listen)
    .mock.calls.at(-1)!;
  turn('Uh');
  turn('Where is the');
  voice(true);
  jest.advanceTimersByTime(2000);
  expect(changed.question).not.toHaveBeenCalled();
  voice(false);
  turn('battery?');
  expect(changed.question).toHaveBeenCalledWith('Where is the battery?');
  session.update({ ...context, thinking: true });
  partial('And why does it matter?');
  expect(changed.cancelQuestion).toHaveBeenCalledTimes(1);
  jest.mocked(speechOutput().speak).mockReturnValueOnce(new Promise(() => {}));
  session.say({
    id: 'battery',
    kind: 'answer',
    reply: 'The battery supplies the starter.',
    caution: '',
    stepKey: null,
  });
  const stops = jest.mocked(speechOutput().stop).mock.calls.length;
  partial('The battery supplies');
  expect(speechOutput().stop).toHaveBeenCalledTimes(stops);
  partial('Stop');
  expect(speechOutput().stop).toHaveBeenCalledTimes(stops + 1);
  session.stop();
  jest.useRealTimers();
  jest.mocked(speechOutput().speak).mockResolvedValue();
});

test('speaks reply and caution with their own ranges and reports spontaneous loss', async () => {
  const changed = events();
  const session = createPipelineVoiceSession({ voice: 'system', hints: [] });
  await session.start(context, changed);
  const stopped = jest.mocked(speechInput().listen).mock.calls.at(-1)![6];
  jest
    .mocked(speechOutput().speak)
    .mockImplementation(async (_text, _locale, onWord) => onWord(0, 4));
  await session.say({
    id: 'notice',
    kind: 'notice',
    reply: 'Read this.',
    caution: 'Keep cool.',
    stepKey: null,
  });
  expect(changed.word.mock.calls).toEqual([
    [null],
    [{ section: 'reply', location: 0, length: 4 }],
    [null],
    [{ section: 'caution', location: 0, length: 4 }],
    [null],
  ]);
  stopped('Audio interrupted');
  expect(changed.ended).toHaveBeenCalledWith('lost', null);
  jest.mocked(speechOutput().speak).mockResolvedValue();
});
