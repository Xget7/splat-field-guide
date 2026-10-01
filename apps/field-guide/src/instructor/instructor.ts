import {
  findPart,
  type Pack,
  type Part,
  type PartId,
  type Procedure,
} from '../domain/pack';
import {
  currentProcedure,
  currentStep,
  isLastStep,
  reduce,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../domain/session';
import { normalize, routeCommand, RouteKind } from './router';

/** What the instructor says, and what it does to the session. */
export interface InstructorAnswer {
  readonly reply: string;
  /** The safety note that goes with the reply, or ''. */
  readonly caution: string;
  /** The subject of the reply, whether or not it changes the selection. */
  readonly part: PartId | null;
  /** Applied to the session; null leaves it as it is. */
  readonly event: SessionEvent | null;
}

// Words that turn a question into a request to walk through a procedure.
const PROCEDURE_INTENT: ReadonlySet<string> = new Set([
  'how',
  'check',
  'checking',
  'steps',
  'procedure',
  'top',
  'refill',
]);
// Words that ask what a part is for rather than what it is.
const DETAILS_INTENT: ReadonlySet<string> = new Set([
  'do',
  'does',
  'why',
  'more',
  'details',
  'work',
  'works',
  'purpose',
]);
// Words that point at the part already on screen.
const CURRENT_PART: ReadonlySet<string> = new Set(['it', 'this', 'here']);

// A key named in full outranks one that only shares a word with the question.
const FULL_KEY_BONUS = 0.5;

const LAST_STEP_REPLY = 'That was the last step.';
const FIRST_STEP_REPLY = 'This is the first step.';
const NO_PROCEDURE_REPLY = 'No procedure is running.';
const ENDED_REPLY = 'Stopped. Ask for a part or a check.';

const wordsOf = (phrase: string): string[] =>
  phrase === '' ? [] : phrase.split(' ');

function partKeys(part: Part): string[] {
  return [part.name, part.id, ...part.aliases].map(normalize);
}

/** The one candidate with the best positive score, or undefined on a tie. */
function best<T>(
  candidates: readonly T[],
  score: (candidate: T) => number,
): T | undefined {
  let top: T | undefined;
  let topScore = 0;
  let tied = false;
  for (const candidate of candidates) {
    const value = score(candidate);
    if (value > topScore) {
      top = candidate;
      topScore = value;
      tied = false;
    } else if (value === topScore && value > 0) {
      tied = true;
    }
  }
  return tied ? undefined : top;
}

// A word shared by several parts ("tank", "fluid") cannot tell them apart, so only words
// one part owns count towards a partial match.
function mentionedPart(
  words: ReadonlySet<string>,
  pack: Pack,
): Part | undefined {
  const owners = new Map<string, Set<string>>();
  pack.parts.forEach(part =>
    partKeys(part).forEach(key =>
      wordsOf(key).forEach(word =>
        owners.set(word, (owners.get(word) ?? new Set()).add(part.id)),
      ),
    ),
  );
  return best(pack.parts, part =>
    Math.max(
      ...partKeys(part).map(key => {
        const keyWords = wordsOf(key);
        const hits = keyWords.filter(word => words.has(word));
        const owned = hits.filter(word => owners.get(word)?.size === 1);
        const full = keyWords.length > 0 && hits.length === keyWords.length;
        return owned.length + (full ? FULL_KEY_BONUS : 0);
      }),
    ),
  );
}

function mentionedProcedure(
  words: ReadonlySet<string>,
  pack: Pack,
): Procedure | undefined {
  return best(
    pack.procedures,
    procedure =>
      wordsOf(normalize(procedure.title)).filter(word => words.has(word))
        .length,
  );
}

/** The part the screen is about: the selection, else the step's first part. */
export function focusPart(state: SessionState, pack: Pack): Part | undefined {
  const id = state.selectedPart ?? currentStep(state, pack)?.parts[0];
  return id === undefined ? undefined : findPart(pack, id);
}

/** The step the session shows after `event`, said as the instructor would. */
function stepAnswer(
  state: SessionState,
  event: SessionEvent,
  pack: Pack,
): InstructorAnswer {
  const next = reduce(state, event, pack);
  const step = currentStep(next, pack);
  if (step === undefined) {
    return { reply: NO_PROCEDURE_REPLY, caution: '', part: null, event: null };
  }
  return {
    reply: step.text,
    caution: step.caution,
    part: step.parts[0] ?? null,
    event,
  };
}

function partAnswer(part: Part, details: boolean): InstructorAnswer {
  return {
    reply: details && part.details !== '' ? part.details : part.summary,
    caution: '',
    part: part.id,
    event: { type: SessionEventType.select, partId: part.id },
  };
}

export function commandAnswer(
  event: SessionEvent,
  state: SessionState,
  pack: Pack,
): InstructorAnswer {
  switch (event.type) {
    case SessionEventType.select: {
      const part =
        event.partId === null ? undefined : findPart(pack, event.partId);
      return part
        ? partAnswer(part, false)
        : { reply: NO_PROCEDURE_REPLY, caution: '', part: null, event: null };
    }
    case SessionEventType.next:
      return isLastStep(state, pack)
        ? { reply: LAST_STEP_REPLY, caution: '', part: null, event: null }
        : stepAnswer(state, event, pack);
    case SessionEventType.back:
      return currentProcedure(state, pack) && state.stepIndex === 0
        ? { reply: FIRST_STEP_REPLY, caution: '', part: null, event: null }
        : stepAnswer(state, event, pack);
    case SessionEventType.start:
    case SessionEventType.repeat:
      return stepAnswer(state, event, pack);
    case SessionEventType.end:
      return { reply: ENDED_REPLY, caution: '', part: null, event };
  }
}

function fallback(pack: Pack): InstructorAnswer {
  const example = pack.parts[0]?.name.toLowerCase() ?? 'a part';
  return {
    reply: `Ask for a part or a check, like “Where is the ${example}?”`,
    caution: '',
    part: null,
    event: null,
  };
}

/**
 * Answers from the pack's own text: a command the router knows, else the part or procedure
 * the question names. Nothing is invented, so an unknown question gets a hint, not a guess.
 */
export function answerFor(
  question: string,
  state: SessionState,
  pack: Pack,
): InstructorAnswer {
  const route = routeCommand(question, pack);
  if (route.kind === RouteKind.command) {
    return commandAnswer(route.event, state, pack);
  }
  const words = new Set(wordsOf(normalize(question)));
  const has = (set: ReadonlySet<string>) =>
    [...words].some(word => set.has(word));
  const part = mentionedPart(words, pack);
  const procedure = mentionedProcedure(words, pack);
  const startProcedure = (found: Procedure) =>
    stepAnswer(
      state,
      { type: SessionEventType.start, procedureId: found.id },
      pack,
    );

  if (procedure && has(PROCEDURE_INTENT)) {
    return startProcedure(procedure);
  }
  if (part) {
    return partAnswer(part, has(DETAILS_INTENT));
  }
  if (procedure) {
    return startProcedure(procedure);
  }
  const current = focusPart(state, pack);
  if (current && has(CURRENT_PART)) {
    return { ...partAnswer(current, has(DETAILS_INTENT)), event: null };
  }
  return fallback(pack);
}
