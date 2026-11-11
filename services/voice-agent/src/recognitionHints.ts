import type { Pack } from '../../../apps/field-guide/src/features/pack/pack.ts';

// The recogniser hears a pack's own names as noise unless it is told them; the app no longer
// needs these hints, so the agent's speech recognition is their only consumer.
export function recognitionHintsFor(pack: Pack): string[] {
  return [
    ...new Set([
      pack.title,
      ...pack.parts.flatMap(part => [part.name, ...part.aliases]),
      ...pack.procedures.map(procedure => procedure.title),
    ]),
  ];
}
