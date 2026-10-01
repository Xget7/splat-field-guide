import type { SplatSource } from 'react-native-splat';
import manifest from '../../../../../data/pack/gol-trend-engine-bay/1/manifest.json';
import type { Pack } from '../../domain/pack';
import { parsePack } from '../../domain/parsePack';

export const bundledPack = parsePack(manifest);

export function sourceFor(pack: Pack): SplatSource {
  const baseDirectory = `packs/${pack.packId}/${pack.packVersion}/`;
  const tier = pack.tiers[0];
  return {
    splatPath: baseDirectory + tier.cloud.path,
    labelsPath: baseDirectory + tier.labels.path,
  };
}
