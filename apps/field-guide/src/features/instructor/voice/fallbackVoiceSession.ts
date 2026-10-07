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
  // The question a dropped conversation left unanswered, kept apart from the viewer's updates until it is asked again.
  let recovering: string | null = null;
  const current = (id: number) => running && generation === id;
  async function startFallback(
    id: number,
    question: string | null,
    automatic = false,
  ) {
    if (!current(id)) {
      return;
    }
    active = fallback;
    await fallback.start(
      {
        ...context,
        pendingQuestion: question ?? pending,
        allowSpeechInstall: automatic ? false : context.allowSpeechInstall,
      },
      events,
    );
    if (!current(id)) {
      return;
    }
    recovering = null;
    onFallbackStarted?.();
    fallback.setMuted(muted);
    if (question !== null) {
      events.question(question);
    }
  }
  async function recoverOnDevice(id: number, question: string | null) {
    try {
      await startFallback(id, question, true);
    } catch {
      if (current(id)) {
        running = false;
        recovering = null;
        events.ended(VoiceEnd.lost, question);
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
    recovering = question;
    if (reason === VoiceEnd.quota || reason === VoiceEnd.auth) {
      primary.stop();
      onPrimaryFailure(reason);
      await recoverOnDevice(id, question);
      return;
    }
    if (reason !== VoiceEnd.network || networkOffline()) {
      running = false;
      recovering = null;
      events.ended(reason, question);
      return;
    }
    primary.stop();
    if (!restarted) {
      restarted = true;
      try {
        await primary.start(context, primaryEvents(id));
        if (current(id)) {
          recovering = null;
          primary.setMuted(muted);
          if (question !== null) {
            primaryQuestions.ask(question);
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
    await recoverOnDevice(id, question);
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
      recovering = null;
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
      pending = active.stop() ?? recovering ?? pending;
      recovering = null;
      return pending;
    },
  };
}
