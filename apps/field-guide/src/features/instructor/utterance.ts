import { normalize } from './router';

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

// Exclude words that can end complete questions to avoid delaying them.
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

// Exclude "can" and "could" because they can introduce requests to start a procedure.
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

const REQUEST_WORDS: ReadonlySet<string> = new Set([
  'begin',
  'guide',
  'lets',
  'start',
  'walk',
]);

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

/** Recognition noise such as "." or "uh" must not interrupt speech or reach the model. */
export function hasSpokenWord(heard: string): boolean {
  return lowerWordsOf(heard).some(
    word =>
      !HESITATIONS.has(word) &&
      (word.match(LETTERS)?.length ?? 0) >= MIN_WORD_LETTERS,
  );
}

/** Distinguish requests for an explanation from requests to perform a procedure. */
export function isAsked(text: string): boolean {
  const words = lowerWordsOf(text.replace(/['’]/g, ''));
  return (
    QUESTION_OPENERS.has(words[0] ?? '') &&
    !words.some(word => REQUEST_WORDS.has(word))
  );
}

/** Treat a pause after an unfinished phrase as thought, not completion. */
export function isUnfinished(heard: string): boolean {
  const words = lowerWordsOf(heard.replace(/['’]/g, ''));
  const last = words[words.length - 1];
  return last === undefined || OPEN_ENDINGS.has(last);
}
