import {
  VoiceEnd,
  type VoiceContext,
  type VoiceSession,
  type VoiceSessionEvents,
  type VoiceStartFailure,
  type TypedQuestions,
} from './voiceSession';
import { isConnectionFailure, voiceFailure } from './voiceFailure';

interface Options {
  primary: VoiceSession;
  primaryQuestions: TypedQuestions;
  fallback: VoiceSession;
  onPrimaryFailure(failure: VoiceStartFailure): void;
  onFallbackStarted?(): void;
  networkOffline(): boolean;
}
export function createFallbackVoiceSession({
  primary,
  primaryQuestions,
  fallback,
  onPrimaryFailure,
  onFallbackStarted,
  networkOffline,
}: Options): VoiceSession & { readonly questions: TypedQuestions | null } {
  let active = primary;
  let context: VoiceContext;
  let events: VoiceSessionEvents;
  let running = false;
  let generation = 0;
  let restarted = false;
  let muted = false;
  let pending: string | null = null;
  const current = (id: number) => running && generation === id;
  async function startFallback(id: number, question: string | null) {
    if (!current(id)) {
      return;
    }
    active = fallback;
    await fallback.start({ ...context, pendingQuestion: pending }, events);
    if (!current(id)) {
      return;
    }
    onFallbackStarted?.();
    fallback.setMuted(muted);
    if (question !== null && pending !== null) {
      events.question(pending);
    }
  }
  async function recoverOnDevice(id: number) {
    try {
      await startFallback(id, pending);
    } catch {
      if (current(id)) {
        running = false;
        events.ended(VoiceEnd.lost, pending);
      }
    }
  }
  async function recover(
    reason: VoiceEnd,
    question: string | null,
    id: number,
  ) {
    if (!current(id)) {
      return;
    }
    pending = question;
    if (reason === VoiceEnd.quota || reason === VoiceEnd.auth) {
      primary.stop();
      onPrimaryFailure(reason);
      await recoverOnDevice(id);
      return;
    }
    if (reason !== VoiceEnd.network || networkOffline()) {
      running = false;
      events.ended(reason, pending);
      return;
    }
    primary.stop();
    if (!restarted) {
      restarted = true;
      try {
        await primary.start(context, primaryEvents(id));
        if (current(id)) {
          primary.setMuted(muted);
          if (pending !== null) {
            primaryQuestions.ask(pending);
          }
        }
        return;
      } catch (error) {
        if (!current(id)) {
          return;
        }
        onPrimaryFailure(voiceFailure(error));
      }
    }
    await recoverOnDevice(id);
  }
  function primaryEvents(id: number): VoiceSessionEvents {
    return {
      ...events,
      ended: (reason, question) => {
        recover(reason, question, id);
      },
    };
  }
  return {
    get questions() {
      return running && active === primary ? primaryQuestions : null;
    },
    async start(initial, changed) {
      context = initial;
      events = changed;
      active = primary;
      running = true;
      restarted = false;
      muted = false;
      pending = initial.pendingQuestion ?? null;
      const id = ++generation;
      try {
        await primary.start(context, primaryEvents(id));
      } catch (error) {
        if (!current(id)) {
          return;
        }
        const reason = voiceFailure(error);
        if (!isConnectionFailure(reason)) {
          throw error;
        }
        primary.stop();
        onPrimaryFailure(reason);
        await startFallback(id, null);
      }
    },
    say: utterance => active.say(utterance),
    update(next) {
      context = next;
      if (next.pendingQuestion !== undefined) {
        pending = next.pendingQuestion;
      }
      active.update(next);
    },
    interrupt() {
      active.interrupt();
    },
    setMuted(value) {
      muted = value;
      active.setMuted(value);
    },
    stop() {
      running = false;
      generation++;
      pending = active.stop() ?? pending;
      return pending;
    },
  };
}
