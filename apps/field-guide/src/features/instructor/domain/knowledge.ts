import type { Pack, Part, RelationType } from '../../pack/pack';
import {
  relationsOf,
  RelationDirection,
  type PartRelation,
} from '../../pack/graph';
import type { InstructorAnswer } from './instructor';

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

/** Explicit graph facts answer relationship questions in either mode without model inference. */
export function relationshipAnswer(
  question: string,
  subject: Part | null,
  relations: readonly PartRelation[],
): InstructorAnswer | null {
  if (!subject || /\b(manual|pdf|section|document)\b/i.test(question))
    return null;
  const flow = /\b(feeds?|fed|feeding|flow|suppl(?:y|ies))\b/i.test(question);
  const connection =
    /\b(relationships?|relations?|connections?|connected|carries|supports|drives)\b/i.test(
      question,
    );
  if (!flow && !connection) return null;
  const found = flow
    ? relations.filter(({ relation }) => relation.type === 'feeds')
    : relations;
  const reply = found.length
    ? `${subject.name}: ${connectionsLine(found)}`
    : flow
    ? `No reviewed feed relationship is recorded for ${subject.name}. A routed connection or a similar embedding does not establish media or flow.`
    : `No reviewed relationship is recorded for ${subject.name}.`;
  return {
    reply,
    caution: '',
    part: subject.id,
    event: { type: 'select', partId: subject.id },
  };
}
