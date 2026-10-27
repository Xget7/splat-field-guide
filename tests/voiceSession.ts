import {
  ExchangePhase,
  nextExchangeId,
  TurnEventType,
  type Utterance,
  type VoiceContext,
  type VoiceConnection,
  type VoiceSession,
  type VoiceSessionEvents,
  type VoiceRuntime,
  type VoiceRuntimeState,
  createModelInstructor,
  instructorStore,
  type InstructorRuntime,
} from '../apps/field-guide/src/features/instructor';

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
/**
 * A voice runtime that hands out one connection; `change` reports new voice state through the
 * app-wide store, as the real runtime does.
 */
export function fakeVoiceRuntime(connection: VoiceConnection) {
  let current = connection;
  const runtime: VoiceRuntime = {
    sessionFor: () =>
      instructorStore.getState().voice.canStart ? current : null,
  };
  return {
    runtime,
    change(next: Partial<VoiceRuntimeState>, replacement = current) {
      current = replacement;
      const voice = instructorStore.getState().voice;
      instructorStore
        .getState()
        .voiceChanged({ ...voice, ...next, revision: voice.revision + 1 });
    },
  };
}

/** An instructor runtime of jest functions that answers nothing, with the given members replaced. */
export function fakeInstructorRuntime(
  overrides: Partial<InstructorRuntime> = {},
): InstructorRuntime {
  return {
    instructor: createModelInstructor([]),
    sessionFor: jest.fn(() => null),
    setPack: jest.fn(),
    setInstructorOpen: jest.fn(),
    setIdle: jest.fn(),
    requestMode: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    ...overrides,
  };
}
