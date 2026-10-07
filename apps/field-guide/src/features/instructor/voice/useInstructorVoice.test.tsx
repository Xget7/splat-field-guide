import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { fixturePack } from '../../../testing/fixturePack';
import { INITIAL_SESSION } from '../../guide/session';
import { useInstructorVoice, type InstructorVoice } from './useInstructorVoice';
import type { VoiceSession, VoiceSessionEvents } from './voiceSession';
import type { ModeStatus } from '../../events/types';
const context = {
  pack: fixturePack(),
  state: INITIAL_SESSION,
  history: [],
  thinking: false,
};
const online: ModeStatus = {
  mode: 'online',
  cause: 'startup',
  voice: 'agent',
  answers: 'claude',
  forced: false,
};

test.each([false, true])(
  'a network switch announces before re-asking one question, from ended: %s',
  async ended => {
    let events!: VoiceSessionEvents;
    const primary: VoiceSession = {
      kind: 'agent',
      start: jest.fn(async (_context, changed) => {
        events = changed;
      }),
      say: jest.fn(async () => {}),
      ask: () => true,
      update: jest.fn(),
      interrupt: jest.fn(),
      setMuted: jest.fn(),
      stop: jest.fn(),
    };
    let finishAnnouncement!: () => void;
    const fallback = {
      ...primary,
      kind: 'pipeline' as const,
      start: jest.fn(async () => {}),
      say: jest.fn(
        () =>
          new Promise<void>(resolve => {
            finishAnnouncement = resolve;
          }),
      ),
      stop: jest.fn(),
    };
    const sessionFor = jest
      .fn()
      .mockReturnValueOnce(primary)
      .mockReturnValue(fallback);
    const onAsk = jest.fn();
    let voice!: InstructorVoice;
    function Harness({ mode }: { mode: ModeStatus }) {
      voice = useInstructorVoice({
        pack: context.pack,
        context,
        enabled: true,
        utterance: null,
        mode,
        sessionFor,
        onAsk,
        onCancel: jest.fn(),
        onTurn: jest.fn(),
        onAction: jest.fn(),
        onIdle: jest.fn(),
        startInVoice: true,
      });
      return null;
    }
    let renderer!: Renderer.ReactTestRenderer;
    await act(async () => {
      renderer = Renderer.create(<Harness mode={online} />);
    });
    await act(async () => {
      events.turn({
        type: 'begin',
        exchange: {
          id: 42,
          phase: 'pending',
          question: 'Why check the battery?',
          reply: '',
          caution: '',
          part: null,
        },
      });
    });
    if (ended) {
      await act(async () => events.ended('network', 'Why check the battery?'));
    }
    await act(async () => {
      renderer.update(
        <Harness
          mode={{ ...online, mode: 'switchingToOffline', cause: 'network' }}
        />,
      );
    });
    expect(primary.stop).toHaveBeenCalledTimes(1);
    expect(voice.on).toBe(true);
    await act(async () => {
      renderer.update(
        <Harness
          mode={{
            ...online,
            mode: 'offline',
            cause: 'network',
            voice: 'device',
            answers: 'script',
          }}
        />,
      );
    });
    expect(fallback.say).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'notice',
        reply: "Offline. Answers come from the guide's script.",
      }),
    );
    expect(onAsk).not.toHaveBeenCalled();
    await act(async () => finishAnnouncement());
    expect(onAsk.mock.calls).toEqual([['Why check the battery?']]);
    await act(async () => {
      renderer.unmount();
    });
  },
);

test('closing the instructor resets mute so the next conversation opens its microphone', async () => {
  const session: VoiceSession = {
    kind: 'pipeline',
    start: jest.fn(async () => {}),
    say: jest.fn(async () => {}),
    ask: () => false,
    update: jest.fn(),
    interrupt: jest.fn(),
    setMuted: jest.fn(),
    stop: jest.fn(),
  };
  const sessionFor = () => session;
  let voice!: InstructorVoice;
  function Harness({ enabled }: { enabled: boolean }) {
    voice = useInstructorVoice({
      pack: context.pack,
      context,
      enabled,
      utterance: null,
      mode: online,
      sessionFor,
      onAsk: jest.fn(),
      onCancel: jest.fn(),
      onTurn: jest.fn(),
      onAction: jest.fn(),
      onIdle: jest.fn(),
      startInVoice: true,
    });
    return null;
  }
  let renderer!: Renderer.ReactTestRenderer;
  await act(async () => {
    renderer = Renderer.create(<Harness enabled />);
  });
  await act(async () => voice.toggleMuted());
  await act(async () => renderer.update(<Harness enabled={false} />));
  await act(async () => renderer.update(<Harness enabled />));
  await act(async () => voice.toggle());
  expect(voice.muted).toBe(false);
  expect(session.setMuted).toHaveBeenLastCalledWith(false);
  await act(async () => renderer.unmount());
});
