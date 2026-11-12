import catalog from '../../../assets/documents/catalog.json';
import { openManualIndex, openPartVectorIndex } from '../../features/semantic';
import type { KnowledgeLoader, ToolKnowledge } from '../../features/instructor';
import {
  readBundledBytes,
  readBundledText,
  verifyBundledResource,
} from '../../platform/bundledResources';

/** One verified local corpus supplies offline prompts and direct ElevenLabs client tools. */
export function createAppKnowledge(): KnowledgeLoader {
  const cache = new Map<string, Promise<ToolKnowledge>>();
  let manuals: Promise<ToolKnowledge['manuals']> | null = null;
  const loadManuals = async () => {
    const receipt = JSON.parse(
      await readBundledText('documents/knowledge-receipt.json'),
    ) as { index: { path: string; bytes: number; sha256: string } };
    if (receipt.index.path !== 'manuals.json')
      throw new Error('Invalid manual resource');
    await Promise.all(
      catalog.map(document =>
        verifyBundledResource(`documents/${document.file}`, document.sha256),
      ),
    );
    return openManualIndex(
      JSON.parse(
        await readBundledText('documents/manuals.json', receipt.index),
      ),
      catalog,
    );
  };
  return pack => {
    const key = `${pack.packId}/${pack.packVersion}`;
    if (!cache.has(key))
      cache.set(
        key,
        (async () => {
          const knowledge: {
            manuals?: ToolKnowledge['manuals'];
            vectors?: ToolKnowledge['vectors'];
          } = {};
          if (pack.packId === 'miris-pilot') {
            manuals ??= loadManuals().catch(() => undefined);
            knowledge.manuals = await manuals;
          }
          if (pack.semantic) {
            try {
              const semantic = pack.semantic;
              const opened = openPartVectorIndex(
                semantic,
                await readBundledBytes(
                  `packs/${key}/${semantic.vectors.path}`,
                  semantic.vectors,
                ),
              );
              if (opened.ok) knowledge.vectors = opened.index;
            } catch {
              /* Missing or corrupt bytes never become usable semantic evidence. */
            }
          }
          return knowledge;
        })(),
      );
    return cache.get(key)!;
  };
}
