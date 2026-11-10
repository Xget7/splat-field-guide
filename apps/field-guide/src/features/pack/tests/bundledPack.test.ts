import { sourceFor } from '../bundledPack';
import { fixturePack } from '@tests/fixturePack';

test('runtime paths and digests come from the supplied pack identity', () => {
  const pack = fixturePack();
  expect(sourceFor(pack)).toEqual({
    splatPath: 'packs/fixture/1/high/world.lodsplat',
    labelsPath: 'packs/fixture/1/high/labels.bin',
    splatSha256: pack.tiers[0].world.sha256,
    labelsSha256: pack.tiers[0].labels.sha256,
    expectedSplatCount: pack.tiers[0].splatCount,
  });
});
