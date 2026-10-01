import { isUserSpeech } from '../model/echo';
import { recognitionHintsFor } from '../model/recognitionHints';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { speechInput, speechOutput } from 'react-native-on-device';
import {
  cancelAnimation,
  ReduceMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { Pack } from '../../../../domain/pack';
import { Motion } from '../../../../shared/ui/theme';
import {
  normalizedLevel,
  SpokenSection,
  wordLevelFor,
  type SpokenWord,
} from '../model/speechPresentation';

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
  handsFreeLost: 'Hands-free stopped listening. Turn it on to try again.',
} as const;
const SpeechPermission = { granted: 'granted' } as const;
const SpeechAvailability = { available: 'available' } as const;

interface Hold {
  readonly id: number;
  readonly startedAt: number;
  released: boolean;
  ready: boolean;
  finishing: boolean;
}

/** Something the instructor says once: an answer, or the step or part on screen. */
export interface Utterance {
  /** A new id is said again even when its text has not changed. */
  readonly id: string;
  readonly reply: string;
  readonly caution: string;
}

interface Options {
  pack: Pack;
  enabled: boolean;
  utterance: Utterance | null;
  /** An answer is on its way, so nothing else should be said meanwhile. */
  thinking: boolean;
  onAsk: (question: string) => void;
  onCancel: () => void;
}

function stopOutput(): void {
  try {
    speechOutput().stop();
  } catch {
    // Native speech may not exist on this device.
  }
}

function cancelInput(): void {
  try {
    speechInput().cancel();
  } catch {
    // Typing remains available without recognition.
  }
}

/**
 * Push to talk is half duplex: every new hold stops output before the microphone starts.
 * Hands free keeps the microphone open with echo cancellation, so the user can talk over
 * an answer to cut it short.
 */
export function useInstructorVoice({
  pack,
  enabled,
  utterance,
  thinking,
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
  const spoken = useRef<string | null>(null);
  const voiceAccess = useRef<Promise<string> | null>(null);
  const hints = useMemo(() => recognitionHintsFor(pack), [pack]);
  const [handsFree, setHandsFree] = useState(false);
  const [muted, setMuted] = useState(false);
  // The hands-free listening in progress, 0 when the microphone is closed.
  const conversation = useRef(0);
  const conversations = useRef(0);
  // What the instructor is saying now, so its own echo is never taken for the user.
  const saying = useRef('');
  const latest = useRef({ onAsk, onCancel, thinking });
  useEffect(() => {
    latest.current = { onAsk, onCancel, thinking };
  });

  const quiet = useCallback(() => {
    saying.current = '';
    setStatus(VoiceState.idle);
    setWord(null);
    setSection(null);
    cancelAnimation(level);
    level.value = 0;
  }, [level]);

  const interrupt = useCallback(() => {
    generation.current += 1;
    hold.current = null;
    stopOutput();
    if (conversation.current === 0) {
      cancelInput();
    }
    setTranscript('');
    quiet();
  }, [quiet]);

  useEffect(() => {
    if (!enabled) {
      interrupt();
      setHandsFree(false);
      setMuted(false);
    }
    return () => {
      generation.current += 1;
      hold.current = null;
      stopOutput();
      cancelInput();
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
    try {
      // Creating the lazy output starts warming its voice off the UI thread.
      speechOutput();
    } catch {
      // Replies can still be read without native speech.
    }
    let active = true;
    const prepare = async () => {
      try {
        const input = speechInput();
        if ((await input.requestPermission()) !== SpeechPermission.granted) {
          return VoiceHint.permission;
        }
        return (await input.prepare(VOICE_LOCALE)) ===
          SpeechAvailability.available
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
    if (!enabled || utterance === null || spoken.current === utterance.id) {
      return;
    }
    spoken.current = utterance.id;
    const id = ++generation.current;
    saying.current = `${utterance.reply} ${utterance.caution}`;
    setStatus(VoiceState.speaking);
    setWord(null);
    setSection(SpokenSection.reply);
    let activeSection: SpokenSection | null = SpokenSection.reply;
    const onWord =
      (subject: SpokenSection) => (location: number, length: number) => {
        const text =
          subject === SpokenSection.reply ? utterance.reply : utterance.caution;
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
          utterance.reply,
          VOICE_LOCALE,
          onWord(SpokenSection.reply),
        );
        if (id !== generation.current) {
          return;
        }
        if (utterance.caution !== '') {
          activeSection = SpokenSection.caution;
          setWord(null);
          setSection(SpokenSection.caution);
          await speechOutput().speak(
            utterance.caution,
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
        quiet();
      }
    };
    speak();
  }, [enabled, utterance, level, quiet]);

  const listening = enabled && canListen && handsFree && !muted;
  useEffect(() => {
    if (!listening) {
      return;
    }
    const id = ++conversations.current;
    conversation.current = id;
    const open = () => conversation.current === id;
    const lost = () => {
      if (open()) {
        conversation.current = 0;
        setHandsFree(false);
        setTranscript('');
        setHint(VoiceHint.handsFreeLost);
      }
    };
    // The user talking over an answer cuts it short, and over a pending one cancels it.
    const heard = (partial: string) => {
      if (!open()) {
        return;
      }
      const speaking = saying.current !== '';
      if (speaking && !isUserSpeech(partial, saying.current)) {
        return;
      }
      if (speaking) {
        generation.current += 1;
        stopOutput();
        quiet();
      }
      if (latest.current.thinking) {
        latest.current.onCancel();
      }
      setHint('');
      setTranscript(partial);
    };
    const turn = (question: string) => {
      if (!open()) {
        return;
      }
      setTranscript('');
      if (saying.current === '' || isUserSpeech(question, saying.current)) {
        latest.current.onAsk(question);
      }
    };
    speechInput()
      .listen(
        VOICE_LOCALE,
        hints,
        heard,
        turn,
        amplitude => {
          // While the instructor talks, the meter follows its words instead.
          if (open() && saying.current === '') {
            level.value = withTiming(normalizedLevel(amplitude), {
              duration: Motion.levelSmoothing,
              reduceMotion: ReduceMotion.Never,
            });
          }
        },
        lost,
      )
      .catch(lost);
    return () => {
      if (open()) {
        conversation.current = 0;
        cancelInput();
        setTranscript('');
      }
    };
  }, [listening, hints, level, quiet]);

  const toggleHandsFree = useCallback(() => {
    interrupt();
    latest.current.onCancel();
    setMuted(false);
    setHint('');
    setHandsFree(!handsFree);
  }, [interrupt, handsFree]);

  const toggleMuted = useCallback(() => setMuted(on => !on), []);

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
    if (!enabled || access === null || handsFree) {
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
  }, [enabled, hints, handsFree, interrupt, onCancel, finish, level]);

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

  // Hands free, the user is heard once their words appear, even over an answer.
  const state =
    status === VoiceState.listening || (listening && transcript !== '')
      ? VoiceState.listening
      : thinking
      ? VoiceState.thinking
      : status;
  return {
    state,
    canListen,
    handsFree,
    muted,
    /** The microphone is open hands free, waiting for the user or hearing them. */
    open: listening,
    toggleHandsFree,
    toggleMuted,
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
