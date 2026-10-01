import {
  findPart,
  NoteTopic,
  type Pack,
  type Part,
  type PartId,
  type Procedure,
} from '../../../domain/pack';
import {
  currentProcedure,
  currentStep,
  isLastStep,
  reduce,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../../../domain/session';
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

// Words that turn a question into a request to walk through a procedure. "How" is not one:
// "how many liters of coolant" asks for a quantity, not the coolant check.
const PROCEDURE_INTENT: ReadonlySet<string> = new Set([
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

// Words for the whole vehicle ("this car") never point at one part, even when an alias
// like "car battery" holds them.
const VEHICLE_WORDS: ReadonlySet<string> = new Set(['car', 'vehicle', 'truck']);

// Joining words name nothing: "and" in "fuse and relay box" must not make "And how many
// liters of coolant?" half about the fuse box.
const JOINING_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'or',
  'the',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
]);

// A key named in full outranks one that only shares a word with the question.
const FULL_KEY_BONUS = 0.5;

/** Said instead of a specification the pack leaves out, so nothing is ever guessed. */
export const NOT_COVERED_REPLY =
  'No data on that. Refer to the technical manual.';

// An oil grade like "5W30" asks about the oil even when the word is missing.
const VISCOSITY_GRADE = /\b\d+w\d*\b/;

// A capacity or grade belongs to the fluid, not to the part holding it: "how much oil does
// the motor take" asks about the oil. Each fluid is named by the words its part is known by.
const COOLANT = 'coolant';
const FLUID_SUBJECTS: readonly (readonly [RegExp, string])[] = [
  [/\b(coolant|antifreeze)\b/, COOLANT],
  [/\bbrake fluid\b/, 'brake fluid'],
  [/\bsteering fluid\b/, 'steering fluid'],
  [new RegExp(`\\boil\\b|${VISCOSITY_GRADE.source}`), 'oil'],
];
// Water in an engine is its coolant; a part that takes water itself, like a battery, keeps it.
const WATER = /\bwater\b/;
const ENGINE_WORDS: ReadonlySet<string> = new Set(['engine', 'motor']);

// Grades, capacities, intervals and ratings: answered only from a part's verified
// specifications, never by a model.
const SPECIFICATION_PATTERNS: readonly RegExp[] = [
  /\b(what|which) (type |kind |grade |brand )?(of )?(oil|coolant|antifreeze|brake fluid|steering fluid|fluid|fuse)s?\b/,
  /\b(how much|how many|how often|capacity|quantity|interval|intervals)\b/,
  /\b(liters?|litres?|quarts?|gallons?|ml|millilit(?:er|re)s?)\b/,
  /\bwhen\b.*\b(change|replace|renew|service)\b/,
  /\b(kilometers|kilometres|km|miles|pressure|torque|psi|viscosity|amps|amperage|specs|specification|specifications)\b/,
  VISCOSITY_GRADE,
];

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
        const owned = hits.filter(
          word =>
            owners.get(word)?.size === 1 &&
            !VEHICLE_WORDS.has(word) &&
            !JOINING_WORDS.has(word),
        );
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
    case SessionEventType.goTo:
    case SessionEventType.repeat:
      return stepAnswer(state, event, pack);
    case SessionEventType.end:
      return { reply: ENDED_REPLY, caution: '', part: null, event };
  }
}

/** Whether `question` asks for a specification the pack deliberately leaves out. */
export function asksForSpecification(question: string): boolean {
  const phrase = normalize(question);
  return SPECIFICATION_PATTERNS.some(pattern => pattern.test(phrase));
}

const NOT_COVERED: InstructorAnswer = {
  reply: NOT_COVERED_REPLY,
  caution: '',
  part: null,
  event: null,
};

const specificationsOf = (part: Part): string | undefined =>
  part.notes.find(note => note.topic === NoteTopic.specifications)?.text;

/**
 * Answers a specification question with the verified specifications of the part it names,
 * or of that part's nearest ancestor that has them, word for word. A question that names no
 * part with specifications gets NOT_COVERED, so nothing is ever guessed.
 */
function specificationAnswer(question: string, pack: Pack): InstructorAnswer {
  const named = specificationSubject(question, pack);
  let part = named === null ? undefined : findPart(pack, named);
  while (part && specificationsOf(part) === undefined) {
    part = part.parent === null ? undefined : findPart(pack, part.parent);
  }
  const specifications = part && specificationsOf(part);
  if (named === null || specifications === undefined) {
    return NOT_COVERED;
  }
  return {
    reply: specifications,
    caution: '',
    part: named,
    event: { type: SessionEventType.select, partId: named },
  };
}

/** The part whose specifications answer `question`: the fluid's, before its container's. */
function specificationSubject(question: string, pack: Pack): PartId | null {
  const phrase = normalize(question);
  const fluids = FLUID_SUBJECTS.filter(([pattern]) => pattern.test(phrase));
  if (fluids.length === 1) {
    return namedPart(fluids[0][1], pack);
  }
  const named = namedPart(question, pack);
  if (fluids.length > 0 || !WATER.test(phrase)) {
    return named;
  }
  const holder = named === null ? undefined : findPart(pack, named);
  const inEngine =
    holder === undefined ||
    partKeys(holder).some(key =>
      wordsOf(key).some(word => ENGINE_WORDS.has(word)),
    );
  return inEngine ? namedPart(COOLANT, pack) : named;
}

/** The part `question` names, whatever is on screen. */
// "When the engine is hot" says when, not what: the question is about the other part it names.
const ENGINE_CONDITION =
  /\b(?:(?:with|while|when|if|after) (?:the |my )?engine (?:is |was )?(?:hot|warm|cold|running|on|off|stopped|idling)|(?:start|stop|run|turn on|turn off|switch off) (?:the |my )?engine)\b/g;

export function namedPart(question: string, pack: Pack): PartId | null {
  const phrase = normalize(question);
  const part =
    mentionedPart(
      new Set(
        wordsOf(
          phrase.replace(ENGINE_CONDITION, ' ').replace(/ +/g, ' ').trim(),
        ),
      ),
      pack,
    ) ?? mentionedPart(new Set(wordsOf(phrase)), pack);
  return part?.id ?? null;
}

/** The procedure `question` asks to walk through, if it names one. */
function requestedProcedure(
  words: ReadonlySet<string>,
  pack: Pack,
): Procedure | undefined {
  const procedure = mentionedProcedure(words, pack);
  return procedure && [...words].some(word => PROCEDURE_INTENT.has(word))
    ? procedure
    : undefined;
}

/**
 * Whether the script alone answers `question`: a command, a specification it must not guess
 * or a procedure to start. The model would only blur those, so it never sees them.
 */
export function isScripted(question: string, pack: Pack): boolean {
  return (
    routeCommand(question, pack).kind === RouteKind.command ||
    asksForSpecification(question) ||
    requestedProcedure(new Set(wordsOf(normalize(question))), pack) !==
      undefined
  );
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
  if (asksForSpecification(question)) {
    return specificationAnswer(question, pack);
  }
  const words = new Set(wordsOf(normalize(question)));
  const has = (set: ReadonlySet<string>) =>
    [...words].some(word => set.has(word));
  const part = mentionedPart(words, pack);
  const procedure = mentionedProcedure(words, pack);
  const requested = requestedProcedure(words, pack);
  // Asking for the procedure already running keeps its place rather than starting it over.
  const startProcedure = (found: Procedure) =>
    stepAnswer(
      state,
      found.id === state.procedureId
        ? { type: SessionEventType.repeat }
        : { type: SessionEventType.start, procedureId: found.id },
      pack,
    );

  if (requested) {
    return startProcedure(requested);
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
