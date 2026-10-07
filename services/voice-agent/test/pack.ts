import { readFile } from 'node:fs/promises';
import { parsePack } from '../../../apps/field-guide/src/features/pack/parsePack.ts';

const MANIFEST_URL = new URL('../../../content/gol-trend-engine-bay/manifest.json', import.meta.url);
const result = parsePack(JSON.parse(await readFile(MANIFEST_URL, 'utf8')));
if (!result.ok) throw new Error(result.error.message);
export const pack = result.pack;
