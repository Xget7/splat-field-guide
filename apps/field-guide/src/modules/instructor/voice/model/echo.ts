import { normalize } from '../../domain/router';

const wordsOf = (text: string): string[] =>
  normalize(text)
    .split(' ')
    .filter(word => word !== '');

/**
 * How many words of `heard` the instructor is not saying in `spoken`: the user's own words,
 * as against its voice leaking past echo cancellation.
 */
export function userWordsIn(heard: string, spoken: string): number {
  const said = new Set(wordsOf(spoken));
  return wordsOf(heard).filter(word => !said.has(word)).length;
}

/** Whether `heard` is the user and not the instructor's own `spoken` words. */
export function isUserSpeech(heard: string, spoken: string): boolean {
  return userWordsIn(heard, spoken) > 0;
}
