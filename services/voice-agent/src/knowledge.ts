import { createHash } from 'node:crypto';
import type { Pack } from '../../../apps/field-guide/src/features/pack/pack.ts';
import { partKnowledge } from '../../../apps/field-guide/src/features/instructor/domain/agent/partKnowledge.ts';

/** Upload prepared facts only, never source PDFs, splats or incompatible MobileCLIP vectors. */
export function knowledgeDocuments(pack: Pack) {
  const scope = `Organization: Miris\nPack: ${pack.packId}\nContent version: ${pack.packVersion}\n`;
  const documents = [
    { key: 'overview', text: `${scope}Course: ${pack.title}\nThis knowledge covers only the prepared Miris content listed here. It is not a complete factory survey. Missing locations, emergency exits, applicability and instructions remain unknown. Training scenario facts are not verified production facts.\nParts: ${pack.parts.map(part => `${part.id}: ${part.name}`).join('\n')}` },
    ...pack.parts.map(part => ({ key: `part:${part.id}`, text: `${scope}Part record: ${part.id}\n${JSON.stringify(partKnowledge(pack, part.id), null, 2)}` })),
    ...pack.procedures.map(procedure => ({ key: `procedure:${procedure.id}`, text: `${scope}Prepared procedure\n${JSON.stringify(procedure, null, 2)}` })),
  ];
  return documents.map(document => ({ ...document, name: `Miris ${pack.packId}/${pack.packVersion} ${document.key}`, digest: createHash('sha256').update(document.text).digest('hex') }));
}
