import {
  NoteTopic,
  type Pack,
  type Part,
  type PartNote,
} from '../../../domain/pack';
import type { SessionState } from '../../../domain/session';
import { focusPart, namedPart } from './instructor';

/**
 * The notes a question gets, at about four characters a token: room for two or three
 * notes while instructions, question, history and answer stay well inside 4096 tokens.
 */
export const MAX_NOTES_CHARS = 1200;
export const MAX_NOTES = 2;

// Words that say which kind of note a question wants, checked in this order.
const TOPIC_WORDS: readonly (readonly [NoteTopic, ReadonlySet<string>])[] = [
  [
    NoteTopic.safety,
    new Set([
      'safe',
      'safety',
      'danger',
      'dangerous',
      'hot',
      'burn',
      'careful',
      'touch',
    ]),
  ],
  [
    NoteTopic.check,
    new Set([
      'check',
      'checking',
      'inspect',
      'look',
      'level',
      'test',
      'measure',
      'read',
      'see',
    ]),
  ],
  [
    NoteTopic.faults,
    new Set([
      'problem',
      'problems',
      'fault',
      'faults',
      'wrong',
      'leak',
      'leaks',
      'leaking',
      'noise',
      'smell',
      'broken',
      'fail',
      'fails',
      'failing',
      'badly',
      'rough',
      'symptom',
      'symptoms',
      'why',
      'warning',
      'overheat',
      'overheating',
      'dead',
      'flat',
      'crack',
      'cracked',
      'low',
      'empty',
      'happens',
      'dying',
      'die',
      'weak',
      'worn',
    ]),
  ],
  [
    NoteTopic.maintenance,
    new Set([
      'maintain',
      'maintenance',
      'clean',
      'care',
      'replace',
      'change',
      'top',
      'refill',
      'service',
    ]),
  ],
  [
    NoteTopic.construction,
    new Set([
      'made',
      'built',
      'material',
      'inside',
      'consist',
      'plastic',
      'metal',
      'construction',
    ]),
  ],
  [
    NoteTopic.purpose,
    new Set([
      'do',
      'does',
      'work',
      'works',
      'purpose',
      'for',
      'function',
      'need',
      'why',
    ]),
  ],
];
// What a part is and does answers most questions that ask for nothing more specific.
const DEFAULT_TOPICS: readonly NoteTopic[] = [
  NoteTopic.identity,
  NoteTopic.purpose,
];

// Words that point at what is on screen rather than naming a part.
const POINTING_WORDS: ReadonlySet<string> = new Set([
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'here',
  'thing',
]);
// Too short or too common in the notes to tell parts apart.
const MIN_MATCH_LENGTH = 4;
const COMMON_WORDS: ReadonlySet<string> = new Set([
  "what's",
  'what',
  'like',
  'does',
  'about',
  'have',
  'with',
  'this',
  'that',
  'there',
  'when',
  'where',
  'which',
  'should',
  'would',
  'could',
  'tell',
  'know',
  'need',
  'from',
  'your',
  'they',
  'them',
  'make',
  'more',
]);
const STEM_LENGTH = 5;

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(word => word !== '');

const stem = (word: string) => word.slice(0, STEM_LENGTH);

export function pointsAtScreen(question: string): boolean {
  return wordsOf(question).some(word => POINTING_WORDS.has(word));
}

function askedTopics(question: string): NoteTopic[] {
  const words = new Set(wordsOf(question));
  return TOPIC_WORDS.filter(([, cues]) =>
    [...cues].some(cue => words.has(cue)),
  ).map(([topic]) => topic);
}

/** The kinds of note `question` asks for, most specific first. */
export function topicsFor(question: string): NoteTopic[] {
  return [...new Set([...askedTopics(question), ...DEFAULT_TOPICS])];
}

/** The part whose notes share the most words with `question`, if one clearly does. */
function partByNotes(question: string, pack: Pack): Part | undefined {
  const asked = new Set(
    wordsOf(question)
      .filter(
        word => word.length >= MIN_MATCH_LENGTH && !COMMON_WORDS.has(word),
      )
      .map(stem),
  );
  let best: Part | undefined;
  let bestScore = 0;
  let tied = false;
  for (const part of pack.parts) {
    const known = new Set(
      wordsOf(part.notes.map(note => note.text).join(' ')).map(stem),
    );
    const score = [...asked].filter(word => known.has(word)).length;
    if (score > bestScore) {
      best = part;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

/** What the question is about: the part it names, the one on screen it points at, or the one its words fit. */
export function subjectOf(
  question: string,
  state: SessionState,
  pack: Pack,
): Part | null {
  const named = namedPart(question, pack);
  if (named !== null) {
    return pack.parts.find(part => part.id === named) ?? null;
  }
  const onScreen = focusPart(state, pack);
  if (onScreen && pointsAtScreen(question)) {
    return onScreen;
  }
  // "What's the purpose?" asks about something without naming it: the part on screen,
  // unless another part's notes answer it. "What's the weather like?" asks about no part.
  return (
    partByNotes(question, pack) ??
    (onScreen && askedTopics(question).length > 0 ? onScreen : null)
  );
}

/** The subject's notes for `question`, in the order it asks for them, within the budget. */
export function notesFor(question: string, part: Part): PartNote[] {
  const picked: PartNote[] = [];
  let used = 0;
  for (const topic of topicsFor(question)) {
    const note = part.notes.find(candidate => candidate.topic === topic);
    if (
      note &&
      picked.length < MAX_NOTES &&
      used + note.text.length <= MAX_NOTES_CHARS
    ) {
      picked.push(note);
      used += note.text.length;
    }
  }
  return picked;
}
