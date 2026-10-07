import {
  VoiceEnd,
  VoiceStartError,
  VoiceStartFailure,
  type VoiceContext,
  type VoiceSession,
  type VoiceSessionEvents,
} from './voiceSession';

interface Options {
  primary: VoiceSession;
  fallback: VoiceSession;
  onPrimaryFailure(failure: VoiceStartFailure): void;
  networkOffline(): boolean;
}
export function createFallbackVoiceSession({
  primary,
  fallback,
  onPrimaryFailure,
  networkOffline,
}: Options): VoiceSession {
  let active = primary;
  let context: VoiceContext;
  let events: VoiceSessionEvents;
  let running = false;
  let generation = 0;
  let restarted = false;
  let muted = false;
  function failure(error: unknown): VoiceStartFailure | null {
    return error instanceof VoiceStartError &&
      [
        VoiceStartFailure.quota,
        VoiceStartFailure.auth,
        VoiceStartFailure.network,
      ].some(value => value === error.failure)
      ? error.failure
      : null;
  }
  async function startFallback(id: number, pending: string | null) {
    if (!running || id !== generation) {
      return;
    }
    active = fallback;
    await fallback.start(context, events);
    if (!running || id !== generation) {
      return;
    }
    fallback.setMuted(muted);
    if (pending !== null) {
      events.question(pending);
    }
  }
  async function recover(reason: VoiceEnd, pending: string | null, id: number) {
    if (!running || id !== generation) {
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
        if (running && id === generation) {
          primary.setMuted(muted);
          if (pending !== null) {
            primary.ask(pending);
          }
        }
        return;
      } catch (error) {
        if (!running || id !== generation) {
          return;
        }
        onPrimaryFailure(failure(error) ?? VoiceStartFailure.failed);
      }
    }
    try {
      await startFallback(id, pending);
    } catch {
      if (running && id === generation) {
        running = false;
        events.ended(VoiceEnd.lost, pending);
      }
    }
  }
  function primaryEvents(id: number): VoiceSessionEvents {
    return {
      ...events,
      ended: (reason, pending) => {
        recover(reason, pending, id);
      },
    };
  }
  return {
    get kind() {
      return active.kind;
    },
    async start(initial, changed) {
      context = initial;
      events = changed;
      active = primary;
      running = true;
      restarted = false;
      muted = false;
      const id = ++generation;
      try {
        await primary.start(context, primaryEvents(id));
      } catch (error) {
        if (!running || id !== generation) {
          return;
        }
        const reason = failure(error);
        if (reason === null) {
          throw error;
        }
        primary.stop();
        onPrimaryFailure(reason);
        await startFallback(id, null);
      }
    },
    say: utterance => active.say(utterance),
    ask: text => running && active.ask(text),
    update(next) {
      context = next;
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
      active.stop();
    },
  };
}
