import { normalize } from './router';

// Sounds a recogniser writes down for a hesitation or a noise; they say nothing.
const HESITATIONS: ReadonlySet<string> = new Set([
  'ah',
  'eh',
  'er',
  'erm',
  'hm',
  'hmm',
  'mhm',
  'mm',
  'oh',
  'uh',
  'uhm',
  'um',
  'umm',
]);

// A phrase ending on one of these is still being said: "where is the", "and what about my".
// Words a whole question can end on ("where the fuse box is", "what is it for") are left out,
// since holding those would keep the speaker waiting on every such question.
const OPEN_ENDINGS: ReadonlySet<string> = new Set([
  ...HESITATIONS,
  'a',
  'an',
  'and',
  'because',
  'but',
  'how',
  'if',
  'my',
  'of',
  'or',
  'the',
  'what',
  'when',
  'where',
  'which',
  'why',
  'your',
]);

// Words a question opens with. "Can" and "could" are left out: "can you check the coolant"
// asks the instructor to do it.
const QUESTION_OPENERS: ReadonlySet<string> = new Set([
  'are',
  'do',
  'does',
  'how',
  'hows',
  'is',
  'should',
  'what',
  'whats',
  'when',
  'which',
  'why',
]);

// Words that ask to be taken through something, however the sentence opens.
const REQUEST_WORDS: ReadonlySet<string> = new Set([
  'begin',
  'guide',
  'lets',
  'start',
  'walk',
]);

// The fewest letters a word needs to be speech rather than a stray sound.
const MIN_WORD_LETTERS = 2;

const LETTERS = /\p{L}/gu;
const SPLIT = /[^\p{L}\p{N}']+/u;

const lowerWordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(SPLIT)
    .filter(word => word !== '');

/** The words of `text` that carry meaning: no punctuation, fillers or hesitations. */
export function contentWordsOf(text: string): string[] {
  const phrase = normalize(text);
  return phrase === ''
    ? []
    : phrase.split(' ').filter(word => !HESITATIONS.has(word));
}

/**
 * Whether `heard` holds a spoken word at all. A recogniser hearing noise writes "." or "uh",
 * which must neither cut the instructor short nor reach the model.
 */
export function hasSpokenWord(heard: string): boolean {
  return lowerWordsOf(heard).some(
    word =>
      !HESITATIONS.has(word) &&
      (word.match(LETTERS)?.length ?? 0) >= MIN_WORD_LETTERS,
  );
}

/**
 * Whether `text` asks about something rather than asking for it: "how do I check the
 * coolant" wants it explained, "check the coolant" or "walk me through it" wants it done.
 */
export function isAsked(text: string): boolean {
  const words = lowerWordsOf(text.replace(/['’]/g, ''));
  return (
    QUESTION_OPENERS.has(words[0] ?? '') &&
    !words.some(word => REQUEST_WORDS.has(word))
  );
}

/** Whether `heard` stops mid-phrase, so a pause there is the speaker thinking, not done. */
export function isUnfinished(heard: string): boolean {
  const words = lowerWordsOf(heard.replace(/['’]/g, ''));
  const last = words[words.length - 1];
  return last === undefined || OPEN_ENDINGS.has(last);
}
