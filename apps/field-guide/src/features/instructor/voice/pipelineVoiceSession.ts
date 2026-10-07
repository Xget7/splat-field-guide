import {
  speechInput,
  speechOutput,
  type SpeechVoice,
} from 'react-native-on-device';
import { isUserSpeech, userWordsIn } from './echo';
import { isQuestion, isScripted } from '../instructor';
import { routeCommand, RouteKind } from '../router';
import { hasSpokenWord, isUnfinished } from '../utterance';
import { speechTextFor, SpokenSection } from './speechPresentation';
import {
  VoiceEnd,
  VoiceSessionKind,
  VoiceStartError,
  VoiceStartFailure,
  type VoiceContext,
  type VoiceSession,
  type VoiceSessionEvents,
} from './voiceSession';

export const VOICE_LOCALE = 'en-US';
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
const BARGE_IN_WORDS = 2;
const UNFINISHED_HOLD_MS = 1500;
const joined = (...parts: string[]) =>
  parts.filter(part => part !== '').join(' ');

interface Options {
  voice: SpeechVoice;
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
  async function listen() {
    const id = ++conversation;
    const open = () => running && !muted && id === conversation;
    const lost = () => {
      if (!open()) {
        return;
      }
      running = false;
      cancelInput();
      interrupt();
      events.ended(VoiceEnd.lost, null);
    };
    const ask = (question: string) => {
      stopHolding();
      held = '';
      events.transcript('');
      if (
        isScripted(question, context.pack) ||
        isQuestion(question, context.pack)
      ) {
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
    kind: VoiceSessionKind.pipeline,
    async start(initial, changed) {
      context = initial;
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
    ask: () => false,
    update(next) {
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
            running = false;
            cancelInput();
            interrupt();
            events.ended(VoiceEnd.lost, null);
          }
        });
      }
    },
    stop() {
      if (!running) {
        return;
      }
      running = false;
      lifecycle++;
      cancelInput();
      interrupt();
    },
  };
}
