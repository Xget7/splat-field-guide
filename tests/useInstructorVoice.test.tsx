import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { fixturePack } from './fixturePack';
import { fakeVoiceRuntime, fakeVoiceSession } from './voiceSession';
import { INITIAL_SESSION } from '../apps/field-guide/src/features/guide/session';
import { ModeAnnouncement } from '../apps/field-guide/src/features/instructor/mode/modeCopy';
import {
  useInstructorVoice,
  type InstructorVoice,
} from '../apps/field-guide/src/features/instructor/voice/useInstructorVoice';
import {
  UtteranceKind,
  utteranceId,
  VoiceEnd,
  VoiceStartError,
  VoiceStartFailure,
} from '../apps/field-guide/src/features/instructor/voice/voiceSession';
import { VoiceHint } from '../apps/field-guide/src/features/instructor/voice/voiceCopy';
const context = {
  pack: fixturePack(),
  state: INITIAL_SESSION,
  history: [],
  thinking: false,
};

function harness(
  runtime: ReturnType<typeof fakeVoiceRuntime>['runtime'],
  onAsk = jest.fn(),
) {
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

test.each([false, true])(
  'a network switch announces before re-asking one question, from ended: %s',
  async ended => {
    const primary = fakeVoiceSession();
    const fallback = fakeVoiceSession();
    const lifecycle = fakeVoiceRuntime({
      session: primary.session,
      questions: primary.questions,
    });
    let finishAnnouncement!: () => void;
    const originalSay = jest
      .mocked(fallback.session.say)
      .getMockImplementation()!;
    jest.mocked(fallback.session.say).mockImplementation(utterance => {
      originalSay(utterance);
      return new Promise(resolve => {
        finishAnnouncement = resolve;
      });
    });
    const questions: string[] = [];
    const h = harness(
      lifecycle.runtime,
      jest.fn(question => questions.push(question)),
    );
    let renderer!: Renderer.ReactTestRenderer;
    await act(async () => {
      renderer = Renderer.create(<h.Harness />);
    });
    await act(async () => {
      h.voice.ask('Why check the battery?');
    });
    if (ended) {
      await act(async () =>
        primary.events.ended(VoiceEnd.network, 'Why check the battery?'),
      );
    }
    await act(async () => lifecycle.change({ canStart: false }));
    expect(primary.open).toBe(false);
    expect(h.voice.on).toBe(true);
    await act(async () =>
      lifecycle.change(
        {
          canStart: true,
          announcement: {
            id: utteranceId(UtteranceKind.notice, 1),
            kind: UtteranceKind.notice,
            reply: ModeAnnouncement.script,
            caution: '',
            stepKey: null,
          },
        },
        { session: fallback.session, questions: null },
      ),
    );
    expect(fallback.spoken.map(utterance => utterance.reply)).toEqual([
      ModeAnnouncement.script,
    ]);
    expect(questions).toEqual([]);
    await act(async () => finishAnnouncement());
    expect(questions).toEqual(['Why check the battery?']);
    await act(async () => renderer.unmount());
  },
);

test('closing the instructor resets mute so the next conversation opens its microphone', async () => {
  const fake = fakeVoiceSession();
  const lifecycle = fakeVoiceRuntime({
    session: fake.session,
    questions: null,
  });
  const h = harness(lifecycle.runtime);
  let renderer!: Renderer.ReactTestRenderer;
  await act(async () => {
    renderer = Renderer.create(<h.Harness />);
  });
  await act(async () => h.voice.toggleMuted());
  expect(h.voice.open).toBe(false);
  await act(async () => renderer.update(<h.Harness enabled={false} />));
  await act(async () => renderer.update(<h.Harness />));
  await act(async () => h.voice.toggle());
  expect(h.voice.muted).toBe(false);
  expect(h.voice.open).toBe(true);
  await act(async () => renderer.unmount());
});

test('returning from the background leaves voice off until the user taps', async () => {
  const fake = fakeVoiceSession();
  const lifecycle = fakeVoiceRuntime({
    session: fake.session,
    questions: fake.questions,
  });
  const questions: string[] = [];
  const h = harness(
    lifecycle.runtime,
    jest.fn(question => questions.push(question)),
  );
  let renderer!: Renderer.ReactTestRenderer;
  await act(async () => {
    renderer = Renderer.create(<h.Harness />);
  });
  await act(async () => {
    h.voice.ask('Why check the battery?');
    lifecycle.change({ foreground: false, canStart: false });
  });
  expect(h.voice.on).toBe(false);
  expect(fake.open).toBe(false);
  await act(async () => lifecycle.change({ foreground: true, canStart: true }));
  expect(h.voice.on).toBe(false);
  expect(fake.open).toBe(false);
  await act(async () => h.voice.toggle());
  expect(h.voice.open).toBe(true);
  expect(questions).toEqual([]);
  await act(async () => renderer.unmount());
});

test('a conversation the agent closes turns voice off without a hint', async () => {
  const fake = fakeVoiceSession();
  const h = harness(
    fakeVoiceRuntime({ session: fake.session, questions: null }).runtime,
  );
  let renderer!: Renderer.ReactTestRenderer;
  await act(async () => {
    renderer = Renderer.create(<h.Harness />);
  });
  await act(async () => fake.events.ended(VoiceEnd.goodbye, null));
  expect(h.voice.on).toBe(false);
  expect(h.voice.hint).toBe('');
  await act(async () => renderer.unmount());
});

test('microphone denial shows the permission hint with voice off', async () => {
  const fake = fakeVoiceSession();
  jest
    .mocked(fake.session.start)
    .mockRejectedValue(new VoiceStartError(VoiceStartFailure.permission));
  const h = harness(
    fakeVoiceRuntime({ session: fake.session, questions: null }).runtime,
  );
  let renderer!: Renderer.ReactTestRenderer;
  await act(async () => {
    renderer = Renderer.create(<h.Harness />);
  });
  expect(h.voice.hint).toBe(VoiceHint.permission);
  expect(h.voice.on).toBe(false);
  expect(h.voice.open).toBe(false);
  await act(async () => renderer.unmount());
});
