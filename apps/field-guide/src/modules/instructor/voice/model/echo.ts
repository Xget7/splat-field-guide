import { normalize } from '../../domain/router';

const wordsOf = (text: string): string[] =>
  normalize(text)
    .split(' ')
    .filter(word => word !== '');

/**
 * Whether `heard` is the user and not the instructor's own `spoken` words leaking past echo
 * cancellation: it has a word the instructor is not saying.
 */
export function isUserSpeech(heard: string, spoken: string): boolean {
  const said = new Set(wordsOf(spoken));
  return wordsOf(heard).some(word => !said.has(word));
}
