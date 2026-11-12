import { partsWithin, type Pack, type Part } from '../../pack/pack';
import { assemblyOf } from '../../pack/graph';
import { normalize } from './router';

/** Shared names remain unresolved until the operator supplies a unique machine or component. */
export function referencedParts(question: string, pack: Pack) {
  const phrase = ` ${normalize(question)} `;
  const matchedLength = (part: Part) =>
    Math.max(
      0,
      ...[part.name, part.id, ...part.aliases]
        .map(normalize)
        .filter(key => key !== '' && phrase.includes(` ${key} `))
        .map(key => key.length),
    );
  const roots = pack.parts.filter(
    part => part.parent === null && matchedLength(part) > 0,
  );
  let candidates = pack.parts;
  if (roots.length === 1) {
    const descendants = partsWithin(pack, roots[0].id).filter(
      part => part.id !== roots[0].id,
    );
    candidates = descendants.some(part => matchedLength(part) > 0)
      ? descendants
      : [roots[0]];
  }
  const longest = Math.max(0, ...candidates.map(matchedLength));
  const matches =
    longest === 0
      ? []
      : candidates.filter(part => matchedLength(part) === longest);
  return matches;
}
export function partClarification(question: string, pack: Pack) {
  const matches = referencedParts(question, pack);
  if (matches.length < 2) return null;
  const choices = matches.map(part => {
    const assembly = assemblyOf(pack, part.id);
    return `${assembly?.name ?? part.name} (${part.id})`;
  });
  return {
    reply: `Which component do you mean: ${choices.join(', ')}?`,
    caution: '',
    part: null,
    event: null,
  };
}
