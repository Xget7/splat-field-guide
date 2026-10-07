import type { Pack } from '../pack/pack';

export function packKnowledge(pack: Pack): string {
  const parts = pack.parts.map(part =>
    [
      `Part: ${part.name}${
        part.aliases.length > 0
          ? ` (also called ${part.aliases.join(', ')})`
          : ''
      }`,
      part.summary,
      ...part.notes.map(note => `${note.topic}: ${note.text}`),
    ].join('\n'),
  );
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
