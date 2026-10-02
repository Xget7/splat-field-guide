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
  speechTextFor,
  SpokenSection,
  wordLevelFor,
  type SpokenWord,
} from '../model/speechPresentation';

export const VOICE_LOCALE = 'en-US';
export const VoiceState = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
} as const;
export type VoiceState = (typeof VoiceState)[keyof typeof VoiceState];

export const VoiceHint = {
  permission: 'Microphone or speech access is denied. You can still type.',
  unavailable:
    'On-device speech recognition is unavailable. You can still type.',
  failed: 'Voice could not start. Try again or type your question.',
  output: 'Speech output is unavailable. You can read the reply here.',
  lost: 'Voice stopped listening. Turn it on to try again.',
} as const;
const SpeechPermission = { granted: 'granted' } as const;
const SpeechAvailability = { available: 'available' } as const;

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
  /** Starts in voice mode rather than reading. */
  startInVoice?: boolean;
}

function warmOutput(): void {
  try {
    // Creating the lazy output starts warming its voice off the UI thread.
    speechOutput();
  } catch {
    // The speak effect reports output that cannot start.
  }
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
 * The instructor is read by default, since reading is faster than listening. Voice is all or
 * nothing: it reads every step and answer aloud and keeps the microphone open with echo
 * cancellation, so the user can ask, give commands and talk over an answer to cut it short.
 */
export function useInstructorVoice({
  pack,
  enabled,
  utterance,
  thinking,
  onAsk,
  onCancel,
  startInVoice = false,
}: Options) {
  const [status, setStatus] = useState<VoiceState>(VoiceState.idle);
  const [transcript, setTranscript] = useState('');
  const [hint, setHint] = useState('');
  const [on, setOn] = useState(startInVoice);
  const [muted, setMuted] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const [word, setWord] = useState<SpokenWord | null>(null);
  const [section, setSection] = useState<SpokenSection | null>(null);
  const level = useSharedValue(0);
  const generation = useRef(0);
  const spoken = useRef<string | null>(null);
  const hints = useMemo(() => recognitionHintsFor(pack), [pack]);
  const voiced = enabled && on;
  // The listening in progress, 0 when the microphone is closed.
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

  // Speech output loads its voice model when first created, so reading never touches it.
  const outputUsed = useRef(startInVoice);
  useEffect(() => {
    if (startInVoice) {
      warmOutput();
    }
    // Only the first render decides; later the user turns voice on and off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interrupt = useCallback(() => {
    generation.current += 1;
    if (outputUsed.current) {
      stopOutput();
    }
    setTranscript('');
    quiet();
  }, [quiet]);

  useEffect(() => {
    if (!voiced) {
      interrupt();
      setMuted(false);
    }
    return () => {
      generation.current += 1;
      if (outputUsed.current) {
        stopOutput();
        cancelInput();
      }
      cancelAnimation(level);
      level.value = 0;
    };
  }, [voiced, interrupt, level]);

  useEffect(() => {
    if (!enabled) {
      setOn(false);
    }
  }, [enabled]);

  useEffect(() => {
    setCanListen(false);
    if (!voiced) {
      return;
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
    prepare().then(reason => {
      if (!active) {
        return;
      }
      if (reason === '') {
        setCanListen(true);
      } else {
        // Voice without a microphone would be the half mode this replaces.
        setOn(false);
        setHint(reason);
      }
    });
    return () => {
      active = false;
    };
  }, [voiced]);

  useEffect(() => {
    if (!voiced || utterance === null || spoken.current === utterance.id) {
      return;
    }
    spoken.current = utterance.id;
    const id = ++generation.current;
    const reply = speechTextFor(utterance.reply);
    saying.current = `${reply} ${utterance.caution}`;
    setStatus(VoiceState.speaking);
    setWord(null);
    setSection(SpokenSection.reply);
    let activeSection: SpokenSection | null = SpokenSection.reply;
    const onWord =
      (subject: SpokenSection) => (location: number, length: number) => {
        const text =
          subject === SpokenSection.reply ? reply : utterance.caution;
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
          reply,
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
  }, [voiced, utterance, level, quiet]);

  const listening = voiced && canListen && !muted;
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
        setOn(false);
        setTranscript('');
        setHint(VoiceHint.lost);
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

  const toggle = useCallback(() => {
    interrupt();
    setHint('');
    if (!on) {
      // Turning voice on reads out what is on screen.
      spoken.current = null;
      outputUsed.current = true;
      warmOutput();
    }
    setOn(!on);
  }, [interrupt, on]);

  const toggleMuted = useCallback(() => setMuted(value => !value), []);

  // The user moved on, by typing a question or changing step: a notice about voice is stale.
  const moveOn = useCallback(() => {
    interrupt();
    setHint('');
  }, [interrupt]);

  const stop = useCallback(() => {
    interrupt();
    onCancel();
  }, [interrupt, onCancel]);

  // The user is heard once their words appear, even over an answer.
  const state =
    listening && transcript !== ''
      ? VoiceState.listening
      : thinking
      ? VoiceState.thinking
      : status;
  return {
    state,
    /** Voice mode: everything is said aloud and the microphone is open unless muted. */
    on,
    muted,
    /** The microphone is open, waiting for the user or hearing them. */
    open: listening,
    toggle,
    toggleMuted,
    transcript,
    hint,
    word,
    section,
    level,
    stop,
    interrupt: moveOn,
  };
}

export type InstructorVoice = ReturnType<typeof useInstructorVoice>;
