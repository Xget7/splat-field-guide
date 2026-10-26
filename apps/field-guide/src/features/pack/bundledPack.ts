import manifest from '../../../../../content/gol-trend-engine-bay/manifest.json';
import type { Pack } from './pack';
import { parsePack } from './parsePack';

export const bundledPack = parsePack(manifest);

// Names follow the native SplatSource: the splat file is the tier's tree and the count its leaves.
export interface PackSource {
  readonly splatPath: string;
  readonly labelsPath: string;
  readonly splatSha256: string;
  readonly labelsSha256: string;
  readonly expectedSplatCount: number;
}

export function sourceFor(pack: Pack): PackSource {
  const baseDirectory = `packs/${pack.packId}/${pack.packVersion}/`;
  const tier = pack.tiers[0];
  return {
    splatPath: baseDirectory + tier.world.path,
    labelsPath: baseDirectory + tier.labels.path,
    splatSha256: tier.world.sha256,
    labelsSha256: tier.labels.sha256,
    expectedSplatCount: tier.splatCount,
  };
}
