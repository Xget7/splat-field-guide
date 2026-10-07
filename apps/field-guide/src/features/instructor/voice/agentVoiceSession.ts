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
import { runAgentTool, stepKeyFor } from '../agent/agentTools';
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
  VoiceSessionKind,
  VoiceStartError,
  VoiceStartFailure,
  type VoiceContext,
  type VoiceSession,
  type VoiceSessionEvents,
} from './voiceSession';

export const AGENT_HISTORY_TURNS = 4;
export const NARRATE_PREFIX = '[narrate] ';
export type SessionAgentHandlers = Omit<
  AgentClientHandlers,
  'status' | 'roundTrip'
>;

export function createAgentVoiceSession({
  client: makeClient,
  pack,
}: {
  client: (handlers: SessionAgentHandlers) => AgentClient;
  pack: Pack;
}): VoiceSession {
  let context: VoiceContext;
  let events: VoiceSessionEvents;
  let client: AgentClient | null = null;
  let exchange: Exchange | null = null;
  let typed: string | null = null;
  let toolStepKey: string | null = null;
  let running = false;
  let started = false;
  let muted = false;
  let saying = false;
  let generation = 0;
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
    kind: VoiceSessionKind.agent,
    async start(initial, changed) {
      context = initial;
      events = changed;
      running = true;
      started = false;
      exchange = null;
      typed = null;
      muted = false;
      toolStepKey = null;
      const id = ++generation;
      const current = () => running && generation === id;
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
        responseText(text) {
          if (!current() || !exchange) {
            return;
          }
          exchange = {
            ...exchange,
            reply: text,
            phase: ExchangePhase.streaming,
          };
          events.turn({ type: TurnEventType.partial, exchange });
        },
        response(text) {
          if (current()) {
            answer(text);
          }
        },
        correction(text) {
          if (current()) {
            answer(text, true);
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
            events.action(outcome.event);
          }
          return { result: outcome.result, isError: !outcome.ok };
        },
        ended(reason) {
          if (!current() || !started) {
            return;
          }
          const pending = finish();
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
          events.listening(true);
        }
      } catch (error) {
        if (!current()) {
          return;
        }
        running = false;
        client.stop();
        const failure = error instanceof Error ? error.message : '';
        throw new VoiceStartError(
          failure === VoiceStartFailure.quota ||
          failure === VoiceStartFailure.auth ||
          failure === VoiceStartFailure.network
            ? failure
            : VoiceStartFailure.failed,
        );
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
      client?.setMuted(value);
      if (running) {
        events.listening(!value);
        events.level(0);
      }
    },
    stop() {
      if (!running) {
        return;
      }
      finish();
      running = false;
      generation++;
      client?.stop();
      quiet();
      events.listening(false);
    },
  };
}
