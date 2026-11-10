import { catalogFor, findReadyGuide, GuideStatus, packFacts } from '../catalog';
import { bundledPack } from '../bundledPack';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
const catalog = catalogFor(pack);

test('the catalog contains only the available bundled guide', () => {
  expect(catalog).toHaveLength(1);
  expect(catalog[0]).toMatchObject({
    id: pack.packId,
    status: GuideStatus.ready,
    pack,
  });
  expect(findReadyGuide(catalog, pack.packId)?.pack).toBe(pack);
});

test('removed placeholders and unknown guides cannot open a pack', () => {
  for (const id of [
    'tactical-truck-engine-bay',
    'rotorcraft-rotor-head',
    'generator-set-panel',
    'drilling-rig-top-drive',
  ]) {
    expect(findReadyGuide(catalog, id)).toBeUndefined();
  }
  expect(findReadyGuide(catalog, 'unknown')).toBeUndefined();
});

test('bundled facts match the on-device pack', () => {
  expect(packFacts(pack)).toEqual({
    splats: '2.4M',
  });
});
