import { audioLink, type AudioLinkSpec } from 'react-native-on-device';
import { voiceFailure } from './voiceFailure';
import type { Pack } from '../../pack/pack';
import {
  AgentEnd,
  type AgentClient,
  type AgentClientHandlers,
} from '../agent/agentClient';
import {
  agentVariables,
  historyUpdate,
  screenUpdate,
} from '../agent/agentVariables';
import { runAgentTool } from '../agent/agentTools';
import { SessionEventType } from '../../guide/session';
import { normalize } from '../router';
import {
  ExchangePhase,
  nextExchangeId,
  TurnEventType,
  type Exchange,
} from '../turn';
import { SpokenSection } from './speechPresentation';
import {
  UtteranceKind,
  VoiceEnd,
  stepKeyFor,
  VoiceStartError,
  VoiceStartFailure,
  type VoiceContext,
  type VoiceSession,
  type TypedQuestions,
  type VoiceSessionEvents,
  type VoicePrompt,
} from './voiceSession';

export const AGENT_HISTORY_TURNS = 4;
export const NARRATE_PREFIX = '[narrate] ';
const STEP_EVENTS: ReadonlySet<string> = new Set([
  SessionEventType.start,
  SessionEventType.next,
  SessionEventType.back,
  SessionEventType.repeat,
  SessionEventType.goTo,
]);
export type SessionAgentHandlers = Omit<
  AgentClientHandlers,
  'status' | 'roundTrip'
>;

export function createAgentVoiceSession({
  client: makeClient,
  pack,
  audio = audioLink,
  prompt = request => request(),
}: {
  client: (handlers: SessionAgentHandlers) => AgentClient;
  pack: Pack;
  audio?: () => Pick<AudioLinkSpec, 'requestPermission'>;
  prompt?: VoicePrompt;
}): VoiceSession & TypedQuestions {
  let context: VoiceContext;
  let events: VoiceSessionEvents;
  let client: AgentClient | null = null;
  let exchange: Exchange | null = null;
  let previous: Exchange | null = null;
  // The exchange each response event answers, so a late correction finds its own reply.
  const replies = new Map<number, number>();
  let typed: string | null = null;
  let toolStepKey: string | null = null;
  let running = false;
  let started = false;
  let muted = false;
  let saying = false;
  let generation = 0;
  let stoppedQuestion: string | null = null;
  // A reply after the exchange is done reads a step the app asked for, which belongs to no question.
  const answering = () =>
    exchange !== null && exchange.phase !== ExchangePhase.done;
  function answer(reply: string, interrupted = false) {
    if (!exchange) {
      return;
    }
    exchange = { ...exchange, reply, phase: ExchangePhase.done, interrupted };
    events.turn({
      type: TurnEventType.answer,
      exchange,
      answer: { reply, caution: '', part: null, event: null },
    });
  }
  function finish(): string | null {
    if (!exchange || exchange.phase === ExchangePhase.done) {
      return null;
    }
    if (exchange.reply !== '') {
      answer(exchange.reply, true);
      return null;
    }
    const pending = exchange.question;
    events.turn({ type: TurnEventType.cancel });
    exchange = null;
    return pending;
  }
  function begin(question: string) {
    finish();
    previous = exchange;
    typed = null;
    exchange = {
      id: nextExchangeId(),
      question,
      reply: '',
      caution: '',
      part: null,
      phase: ExchangePhase.pending,
    };
    events.turn({ type: TurnEventType.begin, exchange });
    events.transcript('');
  }
  function quiet() {
    saying = false;
    events.speaking(null);
    events.word(null);
    events.level(0);
  }
  return {
    async start(initial, changed) {
      context = initial;
      events = changed;
      running = true;
      stoppedQuestion = null;
      started = false;
      exchange = null;
      previous = null;
      replies.clear();
      typed = null;
      muted = false;
      toolStepKey = null;
      const id = ++generation;
      const current = () => running && generation === id;
      try {
        if (!(await prompt(() => audio().requestPermission()))) {
          throw new VoiceStartError(VoiceStartFailure.permission);
        }
      } catch (error) {
        if (!current()) {
          return;
        }
        running = false;
        throw error instanceof VoiceStartError
          ? error
          : new VoiceStartError(VoiceStartFailure.failed);
      }
      if (!current()) {
        return;
      }
      client = makeClient({
        userTranscript(text) {
          if (
            !current() ||
            (typed !== null && normalize(text) === normalize(typed))
          ) {
            return;
          }
          begin(text);
        },
        responseText(text, eventId) {
          if (!current() || !exchange || !answering()) {
            return;
          }
          replies.set(eventId, exchange.id);
          exchange = {
            ...exchange,
            reply: text,
            phase: ExchangePhase.streaming,
          };
          events.turn({ type: TurnEventType.partial, exchange });
        },
        response(text, eventId) {
          if (current() && exchange && answering()) {
            replies.set(eventId, exchange.id);
            answer(text);
          }
        },
        correction(text, eventId) {
          if (!current()) {
            return;
          }
          const owner = replies.get(eventId);
          if (exchange && exchange.id === owner) {
            answer(text, true);
          } else if (previous && previous.id === owner) {
            previous = { ...previous, reply: text, interrupted: true };
            events.turn({
              type: TurnEventType.answer,
              exchange: previous,
              answer: { reply: text, caution: '', part: null, event: null },
            });
          }
        },
        interruption() {
          if (current()) {
            quiet();
          }
        },
        speaking(value) {
          if (!current()) {
            return;
          }
          saying = value;
          events.speaking(value ? SpokenSection.reply : null);
        },
        word(range) {
          if (current()) {
            events.word(
              range ? { section: SpokenSection.reply, ...range } : null,
            );
          }
        },
        level(level) {
          if (current() && !saying && !muted) {
            events.level(level);
          }
        },
        toolCall(name, parameters) {
          const outcome = runAgentTool(name, parameters, context.state, pack);
          if (current() && outcome.ok) {
            toolStepKey = stepKeyFor(outcome.state);
            context = { ...context, state: outcome.state };
            if (
              exchange &&
              answering() &&
              STEP_EVENTS.has(outcome.event.type)
            ) {
              exchange = { ...exchange, readsStep: true };
            }
            events.action(outcome.event);
          }
          return { result: outcome.result, isError: !outcome.ok };
        },
        ended(reason) {
          if (!current() || !started) {
            return;
          }
          const pending = finish();
          stoppedQuestion = pending;
          running = false;
          quiet();
          events.listening(false);
          events.ended(
            reason === AgentEnd.error ? VoiceEnd.lost : reason,
            pending,
          );
        },
      });
      try {
        await client.start(
          agentVariables(initial.state, pack, initial.history.length > 0),
          initial.history.length > 0
            ? [historyUpdate(initial.history.slice(-AGENT_HISTORY_TURNS))]
            : [],
        );
        if (current()) {
          started = true;
          client.setMuted(muted);
          events.listening(!muted);
        }
      } catch (error) {
        if (!current()) {
          return;
        }
        running = false;
        client.stop();
        throw new VoiceStartError(voiceFailure(error));
      }
    },
    async say(utterance) {
      if (!running || utterance.kind === UtteranceKind.answer) {
        return;
      }
      if (
        utterance.kind === UtteranceKind.step &&
        utterance.stepKey === toolStepKey
      ) {
        toolStepKey = null;
        return;
      }
      toolStepKey = null;
      client?.sendText(
        NARRATE_PREFIX +
          utterance.reply +
          (utterance.caution ? ' ' + utterance.caution : ''),
      );
    },
    ask(text) {
      if (!running || !started || text.trim() === '') {
        return false;
      }
      begin(text);
      typed = text;
      client?.sendText(text);
      return true;
    },
    update(next) {
      const changed = stepKeyFor(context.state) !== stepKeyFor(next.state);
      context = next;
      if (running && changed) {
        client?.sendContext(screenUpdate(next.state, pack));
      }
    },
    interrupt() {
      if (running) {
        client?.interrupt();
        quiet();
      }
    },
    setMuted(value) {
      muted = value;
      if (running && started) {
        client?.setMuted(value);
        events.listening(!value);
        events.level(0);
      }
    },
    stop() {
      if (!running) {
        return stoppedQuestion;
      }
      stoppedQuestion = finish();
      running = false;
      generation++;
      client?.stop();
      quiet();
      events.listening(false);
      return stoppedQuestion;
    },
  };
}
