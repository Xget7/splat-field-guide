import { isUserSpeech, userWordsIn } from './echo';
import { recognitionHintsFor } from './recognitionHints';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { speechInput, speechOutput } from 'react-native-on-device';
import {
  cancelAnimation,
  ReduceMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { Pack } from '../../pack/pack';
import { isQuestion, isScripted } from '../instructor';
import { routeCommand, RouteKind } from '../router';
import { hasSpokenWord, isUnfinished } from '../utterance';
import { Motion } from '../../../ui/theme';
import {
  normalizedLevel,
  speechTextFor,
  SpokenSection,
  wordLevelFor,
  type SpokenWord,
} from './speechPresentation';

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
// Require multiple user words to filter noise, while allowing a single command to interrupt.
const BARGE_IN_WORDS = 2;
// Allow time for the rest of an unfinished phrase after an acoustic pause.
const UNFINISHED_HOLD_MS = 1500;

const joined = (...parts: string[]) =>
  parts.filter(part => part !== '').join(' ');
const SpeechAvailability = { available: 'available' } as const;

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

/** Voice mode combines output and continuous input so the user can interrupt spoken answers. */
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
  // Zero means no active microphone conversation.
  const conversation = useRef(0);
  const conversations = useRef(0);
  // Retain spoken text to filter the instructor's echo from user speech.
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
        // Voice mode requires both speech output and microphone input.
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
    // Hold unfinished phrases through speech until continuation or sustained silence.
    let held = '';
    let holding: ReturnType<typeof setTimeout> | null = null;
    const stopHolding = () => {
      if (holding !== null) {
        clearTimeout(holding);
        holding = null;
      }
    };
    const hold = () => {
      stopHolding();
      holding = setTimeout(() => ask(held), UNFINISHED_HOLD_MS);
    };
    const voice = (speaking: boolean) => {
      if (!open() || held === '') {
        return;
      }
      if (speaking) {
        stopHolding();
      } else {
        hold();
      }
    };
    // Filter noise before it can trigger an answer or a paid request.
    const ask = (question: string) => {
      stopHolding();
      held = '';
      setTranscript('');
      if (isScripted(question, pack) || isQuestion(question, pack)) {
        latest.current.onAsk(question);
      }
    };
    const heard = (partial: string) => {
      if (!open() || !hasSpokenWord(partial)) {
        return;
      }
      stopHolding();
      const own = userWordsIn(partial, saying.current);
      const cuts =
        own >= BARGE_IN_WORDS ||
        (own > 0 && routeCommand(partial, pack).kind === RouteKind.command);
      if (saying.current !== '') {
        if (!cuts) {
          return;
        }
        generation.current += 1;
        stopOutput();
        quiet();
      }
      // A continuation invalidates a pending answer even before it forms a complete question.
      if (latest.current.thinking && (cuts || held !== '')) {
        latest.current.onCancel();
      }
      setHint('');
      setTranscript(joined(held, partial));
    };
    const turn = (said: string) => {
      if (!open()) {
        return;
      }
      stopHolding();
      if (saying.current !== '' && !isUserSpeech(said, saying.current)) {
        return;
      }
      const question = joined(held, said);
      if (!hasSpokenWord(question)) {
        held = '';
        setTranscript('');
        return;
      }
      if (isUnfinished(question)) {
        held = question;
        setTranscript(question);
        hold();
        return;
      }
      ask(question);
    };
    speechInput()
      .listen(
        VOICE_LOCALE,
        hints,
        heard,
        turn,
        amplitude => {
          // Use output timing for the meter while the instructor speaks.
          if (open() && saying.current === '') {
            level.value = withTiming(normalizedLevel(amplitude), {
              duration: Motion.levelSmoothing,
              reduceMotion: ReduceMotion.Never,
            });
          }
        },
        voice,
        lost,
      )
      .catch(lost);
    return () => {
      stopHolding();
      if (open()) {
        conversation.current = 0;
        cancelInput();
        setTranscript('');
      }
    };
  }, [listening, pack, hints, level, quiet]);

  const toggle = useCallback(() => {
    interrupt();
    setHint('');
    if (!on) {
      // Clear the spoken id so enabling voice reads the current step.
      spoken.current = null;
      outputUsed.current = true;
      warmOutput();
    }
    setOn(!on);
  }, [interrupt, on]);

  const toggleMuted = useCallback(() => setMuted(value => !value), []);

  const moveOn = useCallback(() => {
    interrupt();
    setHint('');
  }, [interrupt]);

  const stop = useCallback(() => {
    interrupt();
    onCancel();
  }, [interrupt, onCancel]);

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
