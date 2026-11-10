import { readFile } from 'node:fs/promises';
import { parsePack } from '../../../apps/field-guide/src/features/pack/parsePack.ts';
export const manifest = JSON.parse(await readFile(new URL('../../../tests/fixtures/runtime-manifest.json', import.meta.url), 'utf8'));
const result = parsePack(manifest);
if (!result.ok) throw new Error(result.error.message);
export const pack = result.pack;
