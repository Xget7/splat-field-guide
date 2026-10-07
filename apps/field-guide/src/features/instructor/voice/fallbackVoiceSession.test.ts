import { speechInput, speechOutput } from 'react-native-on-device';
import { fixturePack } from '../../../testing/fixturePack';
import { fakeVoiceSession, voiceEvents } from '../../../testing/voiceSession';
import { INITIAL_SESSION } from '../../guide/session';
import { createFallbackVoiceSession } from './fallbackVoiceSession';
import { createPipelineVoiceSession } from './pipelineVoiceSession';
import { SpeechVoice, VOICE_LOCALE } from './voiceCopy';
import {
  UtteranceKind,
  utteranceId,
  VoiceEnd,
  VoiceStartError,
  VoiceStartFailure,
} from './voiceSession';
const context = {
  pack: fixturePack(),
  state: INITIAL_SESSION,
  history: [],
  thinking: false,
};

test('quota marks the primary unavailable and keeps voice working on the fallback', async () => {
  const primary = fakeVoiceSession();
  const fallback = fakeVoiceSession();
  jest
    .mocked(primary.session.start)
    .mockRejectedValue(new VoiceStartError(VoiceStartFailure.quota));
  const failures: string[] = [];
  const session = createFallbackVoiceSession({
    primary: primary.session,
    primaryQuestions: primary.questions,
    fallback: fallback.session,
    onPrimaryFailure: failure => failures.push(failure),
    networkOffline: () => false,
  });
  const changed = voiceEvents();
  await session.start(context, changed);
  await session.say({
    id: utteranceId(UtteranceKind.step, 'first'),
    kind: UtteranceKind.step,
    reply: 'Check the battery.',
    caution: '',
    stepKey: null,
  });
  expect(failures).toEqual([VoiceStartFailure.quota]);
  expect(fallback.spoken.map(utterance => utterance.reply)).toEqual([
    'Check the battery.',
  ]);
  expect(session.questions).toBeNull();
  session.stop();
});

test('reconnects with current history, then re-asks on the fallback', async () => {
  const primary = fakeVoiceSession();
  const fallback = fakeVoiceSession();
  const changed = voiceEvents();
  const session = createFallbackVoiceSession({
    primary: primary.session,
    primaryQuestions: primary.questions,
    fallback: fallback.session,
    onPrimaryFailure: jest.fn(),
    networkOffline: () => false,
  });
  await session.start(context, changed);
  const updated = {
    ...context,
    history: [{ question: 'What is it?', reply: 'The battery.' }],
  };
  session.update(updated);
  primary.events.ended(VoiceEnd.network, 'Why?');
  await Promise.resolve();
  expect(primary.context.history).toEqual(updated.history);
  expect(primary.asked).toEqual(['Why?']);
  primary.events.ended(VoiceEnd.network, 'Why again?');
  await Promise.resolve();
  expect(primary.open).toBe(false);
  expect(fallback.open).toBe(true);
  expect(changed.question.mock.calls.flat()).toEqual(['Why again?']);
  expect(changed.ended.mock.calls).toEqual([]);
  session.stop();
});

test('a failed reconnect re-asks on device while a lost route is forwarded', async () => {
  const primary = fakeVoiceSession();
  const fallback = fakeVoiceSession();
  const changed = voiceEvents();
  let offline = false;
  const session = createFallbackVoiceSession({
    primary: primary.session,
    primaryQuestions: primary.questions,
    fallback: fallback.session,
    onPrimaryFailure: jest.fn(),
    networkOffline: () => offline,
  });
  await session.start(context, changed);
  const heard = primary.events;
  jest
    .mocked(primary.session.start)
    .mockRejectedValue(new VoiceStartError(VoiceStartFailure.network));
  heard.ended(VoiceEnd.network, 'Why?');
  await Promise.resolve();
  await Promise.resolve();
  expect(changed.question.mock.calls.flat()).toEqual(['Why?']);
  session.stop();
  offline = true;
  const immediate = fakeVoiceSession();
  const lost = createFallbackVoiceSession({
    primary: immediate.session,
    primaryQuestions: immediate.questions,
    fallback: fallback.session,
    onPrimaryFailure: jest.fn(),
    networkOffline: () => offline,
  });
  await lost.start(context, changed);
  immediate.events.ended(VoiceEnd.network, 'Still waiting');
  expect(changed.ended.mock.calls).toEqual([
    [VoiceEnd.network, 'Still waiting'],
  ]);
  lost.stop();
});

test.each([VoiceEnd.quota, VoiceEnd.auth])(
  'an active %s end answers its waiting question and the next turn on device',
  async reason => {
    const primary = fakeVoiceSession();
    const failures: string[] = [];
    const session = createFallbackVoiceSession({
      primary: primary.session,
      primaryQuestions: primary.questions,
      fallback: createPipelineVoiceSession({
        voice: SpeechVoice.system,
        hints: [],
      }),
      onPrimaryFailure: failure => failures.push(failure),
      networkOffline: () => false,
    });
    const changed = voiceEvents();
    changed.question.mockImplementation(question => {
      session.say({
        id: utteranceId(UtteranceKind.answer, question),
        kind: UtteranceKind.answer,
        reply: `Answer to ${question}`,
        caution: '',
        stepKey: null,
      });
    });
    await session.start(context, changed);
    primary.events.ended(reason, 'Why check the battery?');
    for (let tick = 0; tick < 8; tick++) {
      await Promise.resolve();
    }
    expect(failures).toEqual([reason]);
    expect(speechOutput().speak).toHaveBeenCalledWith(
      'Answer to Why check the battery?',
      VOICE_LOCALE,
      expect.any(Function),
      SpeechVoice.system,
    );
    const nextTranscript = jest
      .mocked(speechInput().listen)
      .mock.calls.at(-1)![3];
    nextTranscript('Where is the battery?');
    await Promise.resolve();
    expect(changed.question.mock.calls.flat()).toEqual([
      'Why check the battery?',
      'Where is the battery?',
    ]);
    expect(speechOutput().speak).toHaveBeenCalledWith(
      'Answer to Where is the battery?',
      VOICE_LOCALE,
      expect.any(Function),
      SpeechVoice.system,
    );
    expect(primary.open).toBe(false);
    expect(session.questions).toBeNull();
    expect(changed.ended.mock.calls).toEqual([]);
    session.stop();
  },
);

test('a switch takes back the question while a socket failure is starting device voice', async () => {
  const primary = fakeVoiceSession();
  const fallback = fakeVoiceSession();
  let ready!: () => void;
  jest.mocked(fallback.session.start).mockReturnValue(
    new Promise(resolve => {
      ready = resolve;
    }),
  );
  const changed = voiceEvents();
  const session = createFallbackVoiceSession({
    primary: primary.session,
    primaryQuestions: primary.questions,
    fallback: fallback.session,
    onPrimaryFailure: jest.fn(),
    networkOffline: () => false,
  });
  await session.start(context, changed);
  const heard = primary.events;
  jest
    .mocked(primary.session.start)
    .mockRejectedValue(new VoiceStartError(VoiceStartFailure.network));
  heard.ended(VoiceEnd.network, 'Why check the battery?');
  await Promise.resolve();
  expect(session.stop()).toBe('Why check the battery?');
  ready();
  await Promise.resolve();
  expect(changed.question.mock.calls).toEqual([]);
});

test('starting device fallback preserves an existing model question without asking it again', async () => {
  const primary = fakeVoiceSession();
  const fallback = fakeVoiceSession();
  jest
    .mocked(primary.session.start)
    .mockRejectedValue(new VoiceStartError(VoiceStartFailure.network));
  const changed = voiceEvents();
  const session = createFallbackVoiceSession({
    primary: primary.session,
    primaryQuestions: primary.questions,
    fallback: fallback.session,
    onPrimaryFailure: jest.fn(),
    networkOffline: () => false,
  });
  await session.start(
    { ...context, pendingQuestion: 'Why check the battery?' },
    changed,
  );
  expect(changed.question.mock.calls).toEqual([]);
  expect(session.stop()).toBe('Why check the battery?');
});
