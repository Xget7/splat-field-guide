import { bundledPack, sourceFor } from '../src/packs/bundledPack';
import { fixturePack } from '../src/domain/testing/fixturePack';

test('the bundled manifest parses and includes the generated tour first', () => {
  expect(bundledPack.ok).toBe(true);
  if (!bundledPack.ok) {
    throw new Error(bundledPack.error.message);
  }
  expect(bundledPack.pack.procedures[0].id).toBe('tour');
  expect(sourceFor(bundledPack.pack)).toEqual({
    splatPath: 'packs/gol-trend-engine-bay/1/high/cloud.spz',
    labelsPath: 'packs/gol-trend-engine-bay/1/high/labels.bin',
  });
});

test('source uses the pack identity and first tier paths', () => {
  const pack = fixturePack();
  expect(
    sourceFor({
      ...pack,
      packId: 'another-pack',
      packVersion: 12,
      tiers: [
        {
          ...pack.tiers[0],
          cloud: { ...pack.tiers[0].cloud, path: 'low/scene.spz' },
          labels: { ...pack.tiers[0].labels, path: 'low/parts.bin' },
        },
        ...pack.tiers,
      ],
    }),
  ).toEqual({
    splatPath: 'packs/another-pack/12/low/scene.spz',
    labelsPath: 'packs/another-pack/12/low/parts.bin',
  });
});
