import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  cancelAnimation,
  ReduceMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { Pack } from '../../pack/pack';
import type { SessionEvent } from '../../guide/session';
import { type TurnEvent } from '../turn';
import { Motion } from '../../../ui/theme';
import {
  normalizedLevel,
  wordLevelFor,
  type SpokenSection,
} from './speechPresentation';
import { VoiceHint, VoiceStartHint } from './voiceCopy';
import {
  VoiceEnd,
  VoiceStartError,
  VoiceStartFailure,
  type Utterance,
  type VoiceContext,
  type VoiceConnection,
  type VoiceRuntime,
  type VoiceSessionEvents,
} from './voiceSession';

export { VoiceHint, VOICE_LOCALE } from './voiceCopy';
export type { Utterance } from './voiceSession';
export const VoiceState = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
} as const;
export type VoiceState = (typeof VoiceState)[keyof typeof VoiceState];
interface Options {
  pack: Pack;
  enabled: boolean;
  utterance: Utterance | null;
  context: VoiceContext;
  runtime: VoiceRuntime;
  onAsk(question: string): void;
  onCancel(): void;
  onTurn(event: TurnEvent): void;
  onAction(event: SessionEvent): void;
  onIdle(idle: boolean): void;
  startInVoice?: boolean;
}
export function useInstructorVoice(options: Options) {
  const {
    enabled,
    utterance,
    context,
    runtime,
    startInVoice = false,
  } = options;
  const lifecycle = useSyncExternalStore(
    runtime.subscribeVoice,
    runtime.voiceSnapshot,
    runtime.voiceSnapshot,
  );
  const [on, setOn] = useState(startInVoice);
  const [muted, setMuted] = useState(false);
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [hint, setHint] = useState('');
  const [section, setSection] = useState<SpokenSection | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const level = useSharedValue(0);
  const latest = useRef(options);
  latest.current = options;
  const session = useRef<VoiceConnection | null>(null);
  const installRequested = useRef(startInVoice);
  const active = useRef(false);
  const spoken = useRef<string | null>(null);
  const pending = useRef<string | null>(null);
  const speaking = useRef(false);
  const enabledVoice = useRef(on);
  enabledVoice.current = on;
  const muting = useRef(muted);
  muting.current = muted;
  const quiet = useCallback(() => {
    speaking.current = false;
    setOpen(false);
    setTranscript('');
    setSection(null);
    cancelAnimation(level);
    level.value = 0;
  }, [level]);
  const interrupt = useCallback(() => {
    session.current?.session.interrupt();
    setTranscript('');
    setSection(null);
    speaking.current = false;
    cancelAnimation(level);
    level.value = 0;
    setHint('');
  }, [level]);
  useEffect(() => {
    if (!enabled || !lifecycle.foreground) {
      setOn(false);
      setMuted(false);
    }
    if (!lifecycle.foreground) {
      pending.current = null;
    }
  }, [enabled, lifecycle.foreground]);
  useEffect(() => {
    setReady(false);
    if (!enabled || !on || !lifecycle.canStart) {
      quiet();
      return;
    }
    const connection = runtime.sessionFor(options.pack);
    if (connection === null) {
      return;
    }
    const voice = connection.session;
    const allowSpeechInstall = installRequested.current;
    installRequested.current = false;
    let current = true;
    let ended = false;
    let acceptingTurns = true;
    session.current = connection;
    const events: VoiceSessionEvents = {
      listening(value) {
        if (current) {
          setOpen(value);
        }
      },
      transcript(text) {
        if (current) {
          setTranscript(text);
        }
      },
      speaking(value) {
        if (!current) {
          return;
        }
        speaking.current = value !== null;
        setSection(value);
        if (value === null) {
          cancelAnimation(level);
          level.value = 0;
        }
      },
      word(value) {
        if (!current) {
          return;
        }
        if (value) {
          level.value = withSequence(
            withTiming(wordLevelFor(value.length), {
              duration: Motion.wordAttack,
              reduceMotion: ReduceMotion.Never,
            }),
            withTiming(0, {
              duration: Motion.wordDecay,
              reduceMotion: ReduceMotion.Never,
            }),
          );
        }
      },
      level(value) {
        if (current && !speaking.current) {
          level.value = withTiming(normalizedLevel(value), {
            duration: Motion.levelSmoothing,
            reduceMotion: ReduceMotion.Never,
          });
        }
      },
      hint(text) {
        if (current) {
          setHint(text);
        }
      },
      question(text) {
        if (current) {
          latest.current.onAsk(text);
        }
      },
      cancelQuestion() {
        if (current) {
          latest.current.onCancel();
        }
      },
      turn(event) {
        if (!acceptingTurns) {
          return;
        }
        latest.current.onTurn(event);
      },
      action(event) {
        if (current) {
          latest.current.onAction(event);
        }
      },
      ended(reason, question) {
        if (!current) {
          return;
        }
        ended = true;
        pending.current = question;
        active.current = false;
        session.current = null;
        setReady(false);
        quiet();
        const lost = reason === VoiceEnd.audio || reason === VoiceEnd.lost;
        // A conversation the agent closed is over, so voice mode closes with it.
        if (
          lost ||
          reason === VoiceEnd.goodbye ||
          reason === VoiceEnd.silence
        ) {
          setOn(false);
          setMuted(false);
        }
        if (lost) {
          setHint(VoiceHint.lost);
        }
      },
    };
    const start = async () => {
      try {
        await voice.start(
          { ...latest.current.context, allowSpeechInstall },
          events,
        );
        if (!current || ended) {
          return;
        }
        active.current = true;
        voice.setMuted(muting.current);
        if (lifecycle.announcement !== null) {
          await voice.say(lifecycle.announcement);
          if (!current) {
            return;
          }
        }
        const question = pending.current;
        pending.current = null;
        if (question !== null) {
          latest.current.onAsk(question);
        }
        if (current) {
          setReady(true);
        }
      } catch (error) {
        if (!current) {
          return;
        }
        active.current = false;
        session.current = null;
        voice.stop();
        quiet();
        setOn(false);
        setHint(
          VoiceStartHint[
            error instanceof VoiceStartError
              ? error.failure
              : VoiceStartFailure.failed
          ],
        );
      }
    };
    start();
    return () => {
      current = false;
      active.current = false;
      const question = voice.stop();
      if (
        enabledVoice.current &&
        latest.current.enabled &&
        latest.current.runtime.voiceSnapshot().foreground
      ) {
        pending.current = question ?? pending.current;
      } else {
        pending.current = null;
      }
      acceptingTurns = false;
      if (session.current === connection) {
        session.current = null;
      }
      quiet();
    };
    // Source changes during a fallback keep that conversation alive; the next start picks the new source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, on, lifecycle.revision, attempt, runtime, options.pack, quiet]);
  useEffect(() => {
    session.current?.session.update(context);
  }, [context]);
  useEffect(() => {
    if (
      (!ready && lifecycle.announcement !== null) ||
      session.current === null ||
      utterance === null ||
      spoken.current === utterance.id
    ) {
      return;
    }
    spoken.current = utterance.id;
    session.current?.session.say(utterance);
  }, [
    ready,
    utterance,
    enabled,
    on,
    lifecycle.revision,
    lifecycle.announcement,
    attempt,
  ]);
  useEffect(() => {
    session.current?.session.setMuted(muted);
  }, [muted]);
  const idle = section === null && !context.thinking && transcript === '';
  useEffect(() => {
    latest.current.onIdle(idle);
  }, [idle]);
  const toggle = useCallback(() => {
    setHint('');
    if (on && active.current) {
      setOn(false);
      setMuted(false);
    } else {
      installRequested.current = true;
      spoken.current = null;
      setOn(true);
      setAttempt(value => value + 1);
    }
  }, [on]);
  const toggleMuted = useCallback(() => setMuted(value => !value), []);
  const stop = useCallback(() => {
    interrupt();
    latest.current.onCancel();
  }, [interrupt]);
  const ask = useCallback(
    (text: string) =>
      active.current && (session.current?.questions?.ask(text) ?? false),
    [],
  );
  const state =
    open && transcript !== ''
      ? VoiceState.listening
      : context.thinking
      ? VoiceState.thinking
      : section !== null
      ? VoiceState.speaking
      : VoiceState.idle;
  return {
    state,
    on,
    muted,
    open,
    toggle,
    toggleMuted,
    transcript,
    hint,
    section,
    level,
    stop,
    interrupt,
    ask,
  };
}
export type InstructorVoice = ReturnType<typeof useInstructorVoice>;
