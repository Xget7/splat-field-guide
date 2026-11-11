import { loadBundledPacks, sourceFor } from '../bundledPack';
import { fixtureCopy, fixturePack } from '@tests/fixturePack';

const FIXTURE_DIRECTORY = 'fixture/1';

const reader = (...entries: { directory: string; manifest: string }[]) => ({
  manifests: () => entries,
});
const bundled = (manifest: unknown, directory = FIXTURE_DIRECTORY) => ({
  directory,
  manifest: JSON.stringify(manifest),
});

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

test('an app bundle without packs supplies none', () => {
  expect(loadBundledPacks(reader())).toEqual({ ok: true, packs: [] });
});

test('each bundled manifest becomes a parsed pack', () => {
  expect(loadBundledPacks(reader(bundled(fixtureCopy())))).toEqual({
    ok: true,
    packs: [fixturePack()],
  });
});

test('a broken bundled pack fails startup with its directory', () => {
  const unparsable = { directory: FIXTURE_DIRECTORY, manifest: '{' };
  const invalid = { ...fixtureCopy(), schemaVersion: 1 };
  const moved = bundled(fixtureCopy(), 'fixture/2');
  for (const entry of [unparsable, bundled(invalid), moved]) {
    const result = loadBundledPacks(reader(entry));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(
      new RegExp(`^${entry.directory}: `),
    );
  }
});

test('an unreadable bundle fails startup', () => {
  const result = loadBundledPacks({
    manifests: () => {
      throw new Error('no resources');
    },
  });
  expect(result).toEqual({
    ok: false,
    message: 'Bundled packs are unreadable: Error: no resources',
  });
});
