import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { speechInput, speechOutput } from 'react-native-on-device';
import {
  cancelAnimation,
  ReduceMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { Pack } from '../domain/pack';
import { ExchangePhase, type Exchange } from '../screens/viewer/viewerState';
import { Motion } from '../ui/theme';
import {
  normalizedLevel,
  SpokenSection,
  wordLevelFor,
  type SpokenWord,
} from './speechPresentation';

export const VOICE_LOCALE = 'en-US';
export const MIN_HOLD_MS = 350;
export const VoiceState = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
} as const;
export type VoiceState = (typeof VoiceState)[keyof typeof VoiceState];

export const VoiceHint = {
  shortHold: 'Hold the mic while you speak, then release to ask.',
  empty: 'No words heard. Hold the mic and try again.',
  permission: 'Microphone or speech access is denied. You can still type.',
  unavailable:
    'On-device speech recognition is unavailable. You can still type.',
  failed: 'Could not hear you. Try again or type your question.',
  output: 'Speech output is unavailable. You can read the reply here.',
} as const;
const SpeechPermission = { granted: 'granted' } as const;
const SpeechAvailability = { available: 'available' } as const;

export function recognitionHintsFor(pack: Pack): string[] {
  return [
    ...new Set([
      ...pack.parts.flatMap(part => [part.name, ...part.aliases]),
      ...pack.procedures.map(procedure => procedure.title),
    ]),
  ];
}

interface Hold {
  readonly id: number;
  readonly startedAt: number;
  released: boolean;
  ready: boolean;
  finishing: boolean;
}

interface Options {
  pack: Pack;
  enabled: boolean;
  exchange: Exchange | null;
  onAsk: (question: string) => void;
  onCancel: () => void;
}

function stopNativeVoice(): void {
  try {
    speechOutput().stop();
  } catch {
    // Native speech may not exist on this device.
  }
  try {
    speechInput().cancel();
  } catch {
    // Typing remains available without recognition.
  }
}

/** Half duplex: every new hold stops output before the microphone starts. */
export function useInstructorVoice({
  pack,
  enabled,
  exchange,
  onAsk,
  onCancel,
}: Options) {
  const [status, setStatus] = useState<VoiceState>(VoiceState.idle);
  const [transcript, setTranscript] = useState('');
  const [hint, setHint] = useState('');
  const [canListen, setCanListen] = useState(false);
  const [word, setWord] = useState<SpokenWord | null>(null);
  const [section, setSection] = useState<SpokenSection | null>(null);
  const level = useSharedValue(0);
  const generation = useRef(0);
  const hold = useRef<Hold | null>(null);
  const spoken = useRef<Exchange | null>(null);
  const voiceAccess = useRef<Promise<string> | null>(null);
  const hints = useMemo(() => recognitionHintsFor(pack), [pack]);

  const interrupt = useCallback(() => {
    generation.current += 1;
    hold.current = null;
    stopNativeVoice();
    setStatus(VoiceState.idle);
    setTranscript('');
    setWord(null);
    setSection(null);
    cancelAnimation(level);
    level.value = 0;
  }, [level]);

  useEffect(() => {
    if (!enabled) {
      interrupt();
    }
    return () => {
      generation.current += 1;
      hold.current = null;
      stopNativeVoice();
      cancelAnimation(level);
      level.value = 0;
    };
  }, [enabled, interrupt, level]);

  useEffect(() => {
    setCanListen(false);
    if (!enabled) {
      voiceAccess.current = null;
      return;
    }
    setHint('');
    let active = true;
    const prepare = async () => {
      try {
        const input = speechInput();
        if ((await input.requestPermission()) !== SpeechPermission.granted) {
          return VoiceHint.permission;
        }
        return input.availability(VOICE_LOCALE) === SpeechAvailability.available
          ? ''
          : VoiceHint.unavailable;
      } catch {
        return VoiceHint.failed;
      }
    };
    const access = prepare();
    voiceAccess.current = access;
    access.then(reason => {
      if (active) {
        setCanListen(reason === '');
        if (reason !== '') {
          setHint(reason);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (
      !enabled ||
      exchange === null ||
      exchange.phase !== ExchangePhase.done ||
      spoken.current?.id === exchange.id
    ) {
      return;
    }
    spoken.current = exchange;
    const id = ++generation.current;
    setStatus(VoiceState.speaking);
    setWord(null);
    setSection(SpokenSection.reply);
    let activeSection: SpokenSection | null = SpokenSection.reply;
    const onWord =
      (subject: SpokenSection) => (location: number, length: number) => {
        const text =
          subject === SpokenSection.reply ? exchange.reply : exchange.caution;
        if (
          id !== generation.current ||
          activeSection !== subject ||
          !Number.isInteger(location) ||
          !Number.isInteger(length) ||
          location < 0 ||
          location >= text.length ||
          length <= 0
        ) {
          return;
        }
        setWord({ section: subject, location, length });
        level.value = withSequence(
          withTiming(wordLevelFor(length), {
            duration: Motion.wordAttack,
            reduceMotion: ReduceMotion.Never,
          }),
          withTiming(0, {
            duration: Motion.wordDecay,
            reduceMotion: ReduceMotion.Never,
          }),
        );
      };
    const speak = async () => {
      try {
        await speechOutput().speak(
          exchange.reply,
          VOICE_LOCALE,
          onWord(SpokenSection.reply),
        );
        if (id !== generation.current) {
          return;
        }
        if (exchange.caution !== '') {
          activeSection = SpokenSection.caution;
          setWord(null);
          setSection(SpokenSection.caution);
          await speechOutput().speak(
            exchange.caution,
            VOICE_LOCALE,
            onWord(SpokenSection.caution),
          );
        }
      } catch {
        if (id === generation.current) {
          setHint(VoiceHint.output);
        }
      }
      activeSection = null;
      if (id === generation.current) {
        setStatus(VoiceState.idle);
        setWord(null);
        setSection(null);
        cancelAnimation(level);
        level.value = 0;
      }
    };
    speak();
  }, [enabled, exchange, level]);

  const finish = useCallback(
    async (current: Hold) => {
      if (current.finishing || current.id !== generation.current) {
        return;
      }
      current.finishing = true;
      try {
        const question = (await speechInput().finish()).trim();
        if (current.id !== generation.current) {
          return;
        }
        hold.current = null;
        setStatus(VoiceState.idle);
        setTranscript('');
        level.value = 0;
        if (question === '') {
          setHint(VoiceHint.empty);
        } else {
          onAsk(question);
        }
      } catch {
        if (current.id === generation.current) {
          interrupt();
          setHint(VoiceHint.failed);
        }
      }
    },
    [onAsk, interrupt, level],
  );

  const start = useCallback(async () => {
    const access = voiceAccess.current;
    if (!enabled || access === null) {
      return;
    }
    interrupt();
    onCancel();
    const current: Hold = {
      id: ++generation.current,
      startedAt: Date.now(),
      released: false,
      ready: false,
      finishing: false,
    };
    hold.current = current;
    setHint('');
    try {
      const reason = await access;
      if (current.id !== generation.current) {
        return;
      }
      if (reason !== '') {
        interrupt();
        setHint(reason);
        return;
      }
      setStatus(VoiceState.listening);
      await speechInput().start(
        VOICE_LOCALE,
        hints,
        partial => {
          if (current.id === generation.current) {
            setTranscript(partial);
          }
        },
        amplitude => {
          if (current.id === generation.current && !current.finishing) {
            level.value = withTiming(normalizedLevel(amplitude), {
              duration: Motion.levelSmoothing,
              reduceMotion: ReduceMotion.Never,
            });
          }
        },
      );
      if (current.id !== generation.current) {
        return;
      }
      current.ready = true;
      if (current.released) {
        finish(current);
      }
    } catch {
      if (current.id === generation.current) {
        interrupt();
        setHint(VoiceHint.failed);
      }
    }
  }, [enabled, hints, interrupt, onCancel, finish, level]);

  const release = useCallback(() => {
    const current = hold.current;
    if (current === null || current.released) {
      return;
    }
    current.released = true;
    if (Date.now() - current.startedAt < MIN_HOLD_MS) {
      interrupt();
      setHint(VoiceHint.shortHold);
    } else if (current.ready) {
      finish(current);
    }
  }, [finish, interrupt]);

  const stop = useCallback(() => {
    interrupt();
    onCancel();
  }, [interrupt, onCancel]);

  const thinking =
    exchange?.phase === ExchangePhase.pending ||
    exchange?.phase === ExchangePhase.streaming;
  const state =
    status === VoiceState.listening
      ? status
      : thinking
      ? VoiceState.thinking
      : status;
  return {
    state,
    canListen,
    transcript,
    hint,
    word,
    section,
    level,
    start,
    release,
    stop,
    interrupt,
  };
}

export type InstructorVoice = ReturnType<typeof useInstructorVoice>;
