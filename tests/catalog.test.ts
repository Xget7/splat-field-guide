import {
  catalogFor,
  findReadyGuide,
  GuideStatus,
  packFacts,
} from '../apps/field-guide/src/features/pack/catalog';
import { bundledPack } from '../apps/field-guide/src/features/pack/bundledPack';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
const catalog = catalogFor(pack);

test('the bundled guide is first and four guides are coming soon', () => {
  expect(catalog).toHaveLength(5);
  expect(catalog[0]).toMatchObject({
    id: pack.packId,
    status: GuideStatus.ready,
    pack,
  });
  expect(catalog.slice(1).map(guide => guide.status)).toEqual(
    Array(4).fill(GuideStatus.comingSoon),
  );
  expect(findReadyGuide(catalog, pack.packId)?.pack).toBe(pack);
});

test('coming soon and unknown guides cannot open a pack', () => {
  expect(findReadyGuide(catalog, catalog[1].id)).toBeUndefined();
  expect(findReadyGuide(catalog, 'unknown')).toBeUndefined();
});

test('bundled facts match the on-device pack', () => {
  expect(packFacts(pack)).toEqual({
    splats: '2.5M',
  });
});
