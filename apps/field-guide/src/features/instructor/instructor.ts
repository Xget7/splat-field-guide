import {
  findPart,
  NoteTopic,
  type Pack,
  type Part,
  type PartId,
  type Procedure,
} from '../pack/pack';
import {
  currentProcedure,
  currentStep,
  isLastStep,
  reduce,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../guide/session';
import { normalize, routeCommand, RouteKind } from './router';
import { contentWordsOf, isAsked } from './utterance';

export interface InstructorAnswer {
  readonly reply: string;
  /** The safety note that goes with the reply, or ''. */
  readonly caution: string;
  /** The subject of the reply, whether or not it changes the selection. */
  readonly part: PartId | null;
  /** Applied to the session; null leaves it as it is. */
  readonly event: SessionEvent | null;
}

// Exclude "how" because quantity questions such as "how many liters" do not request procedures.
const PROCEDURE_INTENT: ReadonlySet<string> = new Set([
  'check',
  'checking',
  'steps',
  'procedure',
  'top',
  'refill',
]);
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
const CURRENT_PART: ReadonlySet<string> = new Set(['it', 'this', 'here']);

// Whole-vehicle words must not select a part through an alias such as "car battery".
const VEHICLE_WORDS: ReadonlySet<string> = new Set(['car', 'vehicle', 'truck']);

// Ignore joining words so "and" cannot select the fuse and relay box.
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

const FULL_KEY_BONUS = 0.5;

export const NOT_COVERED_REPLY =
  'No data on that. Refer to the technical manual.';

// An oil grade like "5W30" asks about the oil even when the word is missing.
const VISCOSITY_GRADE = /\b\d+w\d*\b/;

// Resolve fluid specifications before container names, as in "how much oil does the motor take".
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

// Specification answers must come from authored facts rather than a model.
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

/** Require one positive maximum; ties yield no candidate. */
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

// Only words unique to one part contribute to partial matches.
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

export function focusPart(state: SessionState, pack: Pack): Part | undefined {
  const id = state.selectedPart ?? currentStep(state, pack)?.parts[0];
  return id === undefined ? undefined : findPart(pack, id);
}

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

function procedureAnswer(procedure: Procedure): InstructorAnswer {
  return {
    reply: procedure.steps.map(step => step.text).join(' '),
    caution: [...new Set(procedure.steps.map(step => step.caution))]
      .filter(caution => caution !== '')
      .join(' '),
    part: null,
    event: null,
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

// Match the requested specification aspect so an oil-grade question does not return capacity.
const SPECIFICATION_ASPECTS: readonly (readonly [RegExp, RegExp])[] = [
  [
    /\b(how much|how many|capacity|quantity|liters?|litres?|quarts?|gallons?|ml)\b/,
    /\bcapacity\b/,
  ],
  [
    /\b(how often|intervals?)\b|\bwhen\b.*\b(change|replace|renew|service)\b/,
    /\binterval\b/,
  ],
  [
    new RegExp(
      `\\b(what|which) (type |kind |grade |brand )?(of )?(oil|fluid)\\b|\\b(grade|viscosity)\\b|${VISCOSITY_GRADE.source}`,
    ),
    /\bgrade\b/,
  ],
];

const SENTENCE_END = /(?<=\.)\s+(?=[A-Z])/;

function relevantSpecifications(
  question: string,
  specifications: string,
): string {
  const phrase = normalize(question);
  const aspect = SPECIFICATION_ASPECTS.find(([asks]) => asks.test(phrase));
  const answering = aspect
    ? specifications
        .split(SENTENCE_END)
        .filter(sentence => aspect[1].test(normalize(sentence)))
    : [];
  return answering.length > 0 ? answering.join(' ') : specifications;
}

/** Use exact authored specifications from the part or its nearest ancestor, declining when absent. */
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
    reply: relevantSpecifications(question, specifications),
    caution: '',
    part: named,
    event: { type: SessionEventType.select, partId: named },
  };
}

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

function requestedProcedure(
  words: ReadonlySet<string>,
  pack: Pack,
): Procedure | undefined {
  const procedure = mentionedProcedure(words, pack);
  return procedure && [...words].some(word => PROCEDURE_INTENT.has(word))
    ? procedure
    : undefined;
}

export function procedureForQuestion(
  question: string,
  pack: Pack,
): Procedure | null {
  return (
    requestedProcedure(new Set(wordsOf(normalize(question))), pack) ?? null
  );
}

/** Keep commands, procedure starts and specifications scripted to preserve deterministic behaviour. */
export function isScripted(question: string, pack: Pack): boolean {
  return (
    routeCommand(question, pack).kind === RouteKind.command ||
    asksForSpecification(question) ||
    // Asked about, a procedure is the model's to explain; asked for, the script starts it.
    (!isAsked(question) &&
      requestedProcedure(new Set(wordsOf(normalize(question))), pack) !==
        undefined)
  );
}

// A question asked in one word still asks something: "Why?" after an answer.
const ONE_WORD_QUESTIONS: ReadonlySet<string> = new Set([
  'how',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'explain',
]);
const MIN_QUESTION_WORDS = 2;

/** Reject stray words and recognition noise before they can trigger a paid request. */
export function isQuestion(question: string, pack: Pack): boolean {
  const words = contentWordsOf(question);
  return (
    words.length >= MIN_QUESTION_WORDS ||
    words.some(word => ONE_WORD_QUESTIONS.has(word)) ||
    mentionedPart(new Set(words), pack) !== undefined
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

/** Unknown questions get a hint because scripted answers use only authored pack text. */
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
  // Keep the current position when the user requests the procedure already running.
  const startProcedure = (found: Procedure) =>
    isAsked(question)
      ? procedureAnswer(found)
      : stepAnswer(
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
