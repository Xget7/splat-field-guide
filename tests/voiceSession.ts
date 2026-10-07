import {
  ExchangePhase,
  nextExchangeId,
  TurnEventType,
} from '../apps/field-guide/src/features/instructor/turn';
import type {
  Utterance,
  VoiceContext,
  VoiceConnection,
  VoiceSession,
  VoiceSessionEvents,
  VoiceRuntime,
  VoiceRuntimeState,
} from '../apps/field-guide/src/features/instructor/voice/voiceSession';

export function voiceEvents() {
  return {
    listening: jest.fn(),
    transcript: jest.fn(),
    speaking: jest.fn(),
    word: jest.fn(),
    level: jest.fn(),
    hint: jest.fn(),
    question: jest.fn(),
    cancelQuestion: jest.fn(),
    turn: jest.fn(),
    action: jest.fn(),
    ended: jest.fn(),
  };
}
export function fakeVoiceSession() {
  let events: VoiceSessionEvents;
  let context: VoiceContext;
  let pending: string | null = null;
  let open = false;
  const spoken: Utterance[] = [];
  const asked: string[] = [];
  const session: VoiceSession = {
    start: jest.fn(async (initial, changed) => {
      context = initial;
      events = changed;
      pending = initial.pendingQuestion ?? null;
      open = true;
      events.listening(true);
    }),
    say: jest.fn(async utterance => {
      spoken.push(utterance);
    }),
    update: jest.fn(next => {
      context = next;
      if (next.pendingQuestion !== undefined) {
        pending = next.pendingQuestion;
      }
    }),
    interrupt: jest.fn(() => {
      events?.speaking(null);
      events?.word(null);
    }),
    setMuted: jest.fn(muted => {
      events?.listening(open && !muted);
    }),
    stop: jest.fn(() => {
      open = false;
      events?.listening(false);
      return pending;
    }),
  };
  const questions = {
    ask: jest.fn((text: string) => {
      if (!open) {
        return false;
      }
      pending = text;
      asked.push(text);
      events.turn({
        type: TurnEventType.begin,
        exchange: {
          id: nextExchangeId(),
          question: text,
          reply: '',
          caution: '',
          part: null,
          phase: ExchangePhase.pending,
        },
      });
      return true;
    }),
  };
  return {
    session,
    questions,
    spoken,
    asked,
    get open() {
      return open;
    },
    get events() {
      return events;
    },
    get context() {
      return context;
    },
  };
}
export function fakeVoiceRuntime(connection: VoiceConnection) {
  let current = connection;
  let snapshot: VoiceRuntimeState = {
    revision: 0,
    canStart: true,
    foreground: true,
    announcement: null,
  };
  const listeners = new Set<() => void>();
  const runtime: VoiceRuntime = {
    voiceSnapshot: () => snapshot,
    subscribeVoice(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sessionFor: () => (snapshot.canStart ? current : null),
  };
  return {
    runtime,
    change(next: Partial<VoiceRuntimeState>, replacement = current) {
      current = replacement;
      snapshot = { ...snapshot, ...next, revision: snapshot.revision + 1 };
      listeners.forEach(listener => listener());
    },
  };
}

export const foregroundAppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => {} }),
};
