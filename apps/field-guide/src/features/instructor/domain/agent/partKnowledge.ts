import {
  findPart,
  partsWithin,
  type Pack,
  type Part,
} from '../../../pack/pack';
import {
  assemblyOf,
  chainThrough,
  feedPath,
  relationsOf,
} from '../../../pack/graph';
const SEARCH_LIMIT = 12;
const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const identity = (part: Part) => ({ id: part.id, name: part.name });
/** Exact prepared facts; similarity never establishes relationships or equipment identity. */
export function partKnowledge(pack: Pack, id: string) {
  const part = findPart(pack, id);
  if (!part) return null;
  const path = feedPath(pack, id);
  const parent = part.parent ? findPart(pack, part.parent) : undefined;
  const assembly = assemblyOf(pack, id);
  return {
    organization: 'Miris',
    pack_id: pack.packId,
    pack_version: pack.packVersion,
    part: {
      id: part.id,
      name: part.name,
      aliases: part.aliases,
      summary: part.summary,
      details: part.details,
      notes: part.notes,
    },
    parent: parent ? identity(parent) : null,
    assembly: assembly ? identity(assembly) : null,
    children: pack.parts.filter(item => item.parent === id).map(identity),
    relations: relationsOf(pack, id).map(({ relation, direction, other }) => ({
      type: relation.type,
      from: relation.from,
      to: relation.to,
      direction,
      other: identity(other),
      evidence: relation.evidence,
    })),
    support_chain: chainThrough(pack, id).map(identity),
    feed_path: {
      upstream: path.upstream.map(identity),
      downstream: path.downstream.map(identity),
    },
    procedures: pack.procedures
      .filter(procedure =>
        procedure.steps.some(step => step.parts.includes(id)),
      )
      .map(procedure => ({ id: procedure.id, title: procedure.title })),
  };
}
export function searchParts(pack: Pack, query: string, within?: string) {
  const normalized = normalize(query);
  const words = normalized.split(' ').filter(Boolean);
  const candidates = within ? partsWithin(pack, within) : pack.parts;
  const exact = candidates.filter(part =>
    [part.id, part.name, ...part.aliases].map(normalize).includes(normalized),
  );
  const matches = exact.length
    ? exact
    : candidates.filter(part => {
        const names = [part.id, part.name, ...part.aliases].map(normalize);
        const assembly = assemblyOf(pack, part.id);
        const text = [
          ...names,
          assembly
            ? normalize(
                `${assembly.id} ${assembly.name} ${assembly.aliases.join(' ')}`,
              )
            : '',
        ].join(' ');
        return (
          names.includes(normalized) ||
          (words.length > 0 &&
            words.every(word => text.split(' ').includes(word)))
        );
      });
  return {
    pack_id: pack.packId,
    pack_version: pack.packVersion,
    matches: matches.slice(0, SEARCH_LIMIT).map(part => {
      const assembly = assemblyOf(pack, part.id);
      return {
        ...identity(part),
        aliases: part.aliases,
        parent_id: part.parent,
        assembly: assembly ? identity(assembly) : null,
      };
    }),
    total: matches.length,
    truncated: matches.length > SEARCH_LIMIT,
    needs_clarification: matches.length > 1,
  };
}
