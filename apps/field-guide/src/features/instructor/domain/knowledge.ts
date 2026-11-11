import type { Pack, RelationType } from '../../pack/pack';
import {
  relationsOf,
  RelationDirection,
  type PartRelation,
} from '../../pack/graph';

// How a relation reads from the part's side; adjacency is symmetric, so it reads the same.
const PHRASES: Record<RelationType, Record<RelationDirection, string>> = {
  feeds: { outgoing: 'feeds', incoming: 'is fed by' },
  routes: { outgoing: 'routes to', incoming: 'has a routed connection from' },
  carries: { outgoing: 'carries', incoming: 'is carried by' },
  supports: { outgoing: 'supports', incoming: 'is supported by' },
  drives: { outgoing: 'drives', incoming: 'is driven by' },
  adjacent: { outgoing: 'is next to', incoming: 'is next to' },
};

/** One line naming each connection and the evidence it rests on. */
export function connectionsLine(relations: readonly PartRelation[]): string {
  const items = relations.map(
    ({ relation, direction, other }) =>
      `${PHRASES[relation.type][direction]} ${other.name} (${
        relation.evidence.source
      })`,
  );
  return `Connections: ${items.join('; ')}.`;
}

export function packKnowledge(pack: Pack): string {
  const parts = pack.parts.map(part => {
    const relations = relationsOf(pack, part.id);
    return [
      `Part: ${part.name}${
        part.aliases.length > 0
          ? ` (also called ${part.aliases.join(', ')})`
          : ''
      }`,
      part.summary,
      ...part.notes.map(note => `${note.topic}: ${note.text}`),
      ...(relations.length > 0 ? [connectionsLine(relations)] : []),
    ].join('\n');
  });
  const procedures = pack.procedures.map(
    procedure =>
      `${procedure.title}: ${procedure.steps
        .map(step =>
          [step.text, step.caution === '' ? '' : `Caution: ${step.caution}`]
            .filter(Boolean)
            .join(' '),
        )
        .join(' ')}`,
  );
  return [
    'Notes:',
    parts.join('\n\n'),
    '',
    'Guided checks in this guide:',
    procedures.join('\n'),
  ].join('\n');
}
