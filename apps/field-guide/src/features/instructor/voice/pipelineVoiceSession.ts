import {
  speechInput,
  speechOutput,
  type SpeechVoice as NativeSpeechVoice,
} from 'react-native-on-device';
import { isUserSpeech, userWordsIn } from './echo';
import { isQuestion, isScripted } from '../instructor';
import { routeCommand, RouteKind } from '../router';
import { hasSpokenWord, isUnfinished } from '../utterance';
import { speechTextFor, SpokenSection } from './speechPresentation';
import {
  UtteranceKind,
  VoiceEnd,
  VoiceStartError,
  VoiceStartFailure,
  type VoiceContext,
  type VoiceSession,
  type VoiceSessionEvents,
} from './voiceSession';

import {
  VoiceHint,
  SpeechPermission,
  SpeechAvailability,
  VOICE_LOCALE,
} from './voiceCopy';
export { VOICE_LOCALE } from './voiceCopy';
const BARGE_IN_WORDS = 2;
const UNFINISHED_HOLD_MS = 1500;
const joined = (...parts: string[]) =>
  parts.filter(part => part !== '').join(' ');

interface Options {
  voice: NativeSpeechVoice;
  hints: string[];
  input?: typeof speechInput;
  output?: typeof speechOutput;
}
export function createPipelineVoiceSession({
  voice,
  hints,
  input = speechInput,
  output = speechOutput,
}: Options): VoiceSession {
  let context: VoiceContext;
  let events: VoiceSessionEvents;
  let running = false;
  let muted = false;
  let generation = 0;
  let lifecycle = 0;
  let conversation = 0;
  let saying = '';
  let pending: string | null = null;
  let held = '';
  let holding: ReturnType<typeof setTimeout> | null = null;
  function stopHolding() {
    if (holding !== null) {
      clearTimeout(holding);
      holding = null;
    }
  }
  function quiet() {
    saying = '';
    events.speaking(null);
    events.word(null);
    events.level(0);
  }
  function interrupt() {
    generation++;
    try {
      output().stop();
    } catch {
      /* Reading remains available without native output. */
    }
    if (events) {
      events.transcript('');
      quiet();
    }
  }
  function cancelInput() {
    conversation++;
    stopHolding();
    held = '';
    try {
      input().cancel();
    } catch {
      /* Input may be unavailable before startup. */
    }
    events.listening(false);
    events.transcript('');
  }
  function lose() {
    if (!running) {
      return;
    }
    running = false;
    cancelInput();
    interrupt();
    events.ended(VoiceEnd.lost, pending);
  }
  async function listen() {
    const id = ++conversation;
    const open = () => running && !muted && id === conversation;
    const lost = () => {
      if (!open()) {
        return;
      }
      lose();
    };
    const ask = (question: string) => {
      stopHolding();
      held = '';
      events.transcript('');
      if (
        isScripted(question, context.pack) ||
        isQuestion(question, context.pack)
      ) {
        pending = question;
        events.question(question);
      }
    };
    const hold = () => {
      stopHolding();
      holding = setTimeout(() => {
        if (open()) {
          ask(held);
        }
      }, UNFINISHED_HOLD_MS);
    };
    await input()
      .listen(
        VOICE_LOCALE,
        hints,
        partial => {
          if (!open() || !hasSpokenWord(partial)) {
            return;
          }
          stopHolding();
          const own = userWordsIn(partial, saying);
          const cuts =
            own >= BARGE_IN_WORDS ||
            (own > 0 &&
              routeCommand(partial, context.pack).kind === RouteKind.command);
          if (saying !== '') {
            if (!cuts) {
              return;
            }
            interrupt();
          }
          if (context.thinking && (cuts || held !== '')) {
            events.cancelQuestion();
          }
          events.hint('');
          events.transcript(joined(held, partial));
        },
        said => {
          if (!open()) {
            return;
          }
          stopHolding();
          if (saying !== '' && !isUserSpeech(said, saying)) {
            return;
          }
          const question = joined(held, said);
          if (!hasSpokenWord(question)) {
            held = '';
            events.transcript('');
            return;
          }
          if (isUnfinished(question)) {
            held = question;
            events.transcript(question);
            hold();
            return;
          }
          ask(question);
        },
        amplitude => {
          if (open() && saying === '') {
            events.level(amplitude);
          }
        },
        speaking => {
          if (!open() || held === '') {
            return;
          }
          if (speaking) {
            stopHolding();
          } else {
            hold();
          }
        },
        lost,
      )
      .catch(lost);
    if (open()) {
      events.listening(true);
    }
  }
  return {
    async start(initial, changed) {
      context = initial;
      pending = initial.pendingQuestion ?? null;
      events = changed;
      const id = ++lifecycle;
      running = true;
      muted = false;
      try {
        // Output preparation can overlap permission and locale preparation.
        try {
          output()
            .prepare(voice)
            .catch(() => {
              if (running && id === lifecycle) {
                events.hint(VoiceHint.output);
              }
            });
        } catch {
          events.hint(VoiceHint.output);
        }
        if ((await input().requestPermission()) !== SpeechPermission.granted) {
          throw new VoiceStartError(VoiceStartFailure.permission);
        }
        if (
          (await input().prepare(VOICE_LOCALE)) !== SpeechAvailability.available
        ) {
          throw new VoiceStartError(VoiceStartFailure.unavailable);
        }
        if (!running || id !== lifecycle) {
          return;
        }
        await listen();
      } catch (error) {
        if (!running || id !== lifecycle) {
          return;
        }
        running = false;
        cancelInput();
        interrupt();
        throw error instanceof VoiceStartError
          ? error
          : new VoiceStartError(VoiceStartFailure.failed);
      }
    },
    async say(utterance) {
      if (utterance.kind === UtteranceKind.answer) {
        pending = null;
      }
      if (!running) {
        return;
      }
      const id = ++generation;
      const reply = speechTextFor(utterance.reply);
      saying = joined(reply, utterance.caution);
      let activeSection: SpokenSection | null = null;
      try {
        for (const [section, text] of [
          [SpokenSection.reply, reply],
          [SpokenSection.caution, utterance.caution],
        ] as const) {
          if (text === '' || id !== generation) {
            continue;
          }
          activeSection = section;
          events.word(null);
          events.speaking(section);
          await output().speak(
            text,
            VOICE_LOCALE,
            (location, length) => {
              if (
                running &&
                id === generation &&
                activeSection === section &&
                Number.isInteger(location) &&
                Number.isInteger(length) &&
                location >= 0 &&
                location < text.length &&
                length > 0
              ) {
                events.word({
                  section,
                  location,
                  length: Math.min(length, text.length - location),
                });
              }
            },
            voice,
          );
        }
      } catch {
        if (id === generation) {
          events.hint(VoiceHint.output);
        }
      }
      activeSection = null;
      if (id === generation) {
        quiet();
      }
    },
    update(next) {
      if (next.pendingQuestion !== undefined) {
        pending = next.pendingQuestion;
      } else if (context.thinking && !next.thinking) {
        pending = null;
      }
      context = next;
    },
    interrupt,
    setMuted(value) {
      if (muted === value) {
        return;
      }
      muted = value;
      if (!running) {
        return;
      }
      if (muted) {
        cancelInput();
      } else {
        listen().catch(() => {
          if (running) {
            lose();
          }
        });
      }
    },
    stop() {
      if (!running) {
        return pending;
      }
      running = false;
      lifecycle++;
      cancelInput();
      interrupt();
      return pending;
    },
  };
}
