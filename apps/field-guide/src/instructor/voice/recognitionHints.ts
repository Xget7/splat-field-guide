import type { Pack } from '../../pack/pack';

export function recognitionHintsFor(pack: Pack): string[] {
  return [
    ...new Set([
      // The subject's own name ("Gol Trend") is no dictionary phrase.
      pack.title,
      ...pack.parts.flatMap(part => [part.name, ...part.aliases]),
      ...pack.procedures.map(procedure => procedure.title),
    ]),
  ];
}
