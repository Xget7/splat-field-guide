import { normalize } from '../router';

const wordsOf = (text: string): string[] =>
  normalize(text)
    .split(' ')
    .filter(word => word !== '');

/** Count user words that differ from output leaking past echo cancellation. */
export function userWordsIn(heard: string, spoken: string): number {
  const said = new Set(wordsOf(spoken));
  return wordsOf(heard).filter(word => !said.has(word)).length;
}

export function isUserSpeech(heard: string, spoken: string): boolean {
  return userWordsIn(heard, spoken) > 0;
}
