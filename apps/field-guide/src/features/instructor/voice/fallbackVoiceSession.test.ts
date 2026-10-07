import { fixturePack } from '../../../testing/fixturePack';
import { INITIAL_SESSION } from '../../guide/session';
import { createFallbackVoiceSession } from './fallbackVoiceSession';
import {
  VoiceStartError,
  type VoiceSessionEvents,
  type VoiceSession,
} from './voiceSession';
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
const fake = (): VoiceSession => ({
  kind: 'agent',
  start: jest.fn(async () => {}),
  say: jest.fn(async () => {}),
  ask: jest.fn(() => true),
  update: jest.fn(),
  interrupt: jest.fn(),
  setMuted: jest.fn(),
  stop: jest.fn(),
});

test('quota marks the primary unavailable and keeps voice working on the fallback', async () => {
  const primary = fake();
  const fallback = fake();
  jest.mocked(primary.start).mockRejectedValue(new VoiceStartError('quota'));
  const failed = jest.fn();
  const session = createFallbackVoiceSession({
    primary,
    fallback,
    onPrimaryFailure: failed,
    networkOffline: () => false,
  });
  const changed = events();
  await session.start(context, changed);
  expect(failed).toHaveBeenCalledWith('quota');
  expect(fallback.start).toHaveBeenCalled();
  session.ask('next');
  expect(fallback.ask).toHaveBeenCalledWith('next');
});

test('reconnects once with current history, then re-asks on the fallback', async () => {
  let heard!: VoiceSessionEvents;
  const primary = fake();
  const fallback = fake();
  jest.mocked(primary.start).mockImplementation(async (_context, changed) => {
    heard = changed;
  });
  const changed = events();
  const session = createFallbackVoiceSession({
    primary,
    fallback,
    onPrimaryFailure: jest.fn(),
    networkOffline: () => false,
  });
  await session.start(context, changed);
  const updated = {
    ...context,
    history: [{ question: 'What is it?', reply: 'The battery.' }],
  };
  session.update(updated);
  heard.ended('network', 'Why?');
  await Promise.resolve();
  expect(primary.start).toHaveBeenLastCalledWith(updated, expect.any(Object));
  expect(primary.ask).toHaveBeenCalledWith('Why?');
  heard.ended('network', 'Why again?');
  await Promise.resolve();
  expect(primary.start).toHaveBeenCalledTimes(2);
  expect(changed.question).toHaveBeenCalledWith('Why again?');
  expect(changed.ended).not.toHaveBeenCalled();
});

test('a failed reconnect re-asks on device while a lost route is forwarded', async () => {
  let heard!: VoiceSessionEvents;
  const primary = fake();
  const fallback = fake();
  jest
    .mocked(primary.start)
    .mockImplementationOnce(async (_context, changed) => {
      heard = changed;
    })
    .mockRejectedValue(new VoiceStartError('network'));
  let offline = false;
  const changed = events();
  const session = createFallbackVoiceSession({
    primary,
    fallback,
    onPrimaryFailure: jest.fn(),
    networkOffline: () => offline,
  });
  await session.start(context, changed);
  heard.ended('network', 'Why?');
  await Promise.resolve();
  await Promise.resolve();
  expect(changed.question).toHaveBeenCalledWith('Why?');
  offline = true;
  const immediate = fake();
  jest.mocked(immediate.start).mockImplementation(async (_context, event) => {
    heard = event;
  });
  const lost = createFallbackVoiceSession({
    primary: immediate,
    fallback,
    onPrimaryFailure: jest.fn(),
    networkOffline: () => offline,
  });
  await lost.start(context, changed);
  heard.ended('network', 'Still waiting');
  expect(changed.ended).toHaveBeenCalledWith('network', 'Still waiting');
});
