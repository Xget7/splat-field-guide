const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  prepareAssets,
} = require('../../../apps/field-guide/scripts/prepare-android-assets.cjs');

const root = path.resolve(__dirname, '../build');

test('Android packages only verified runtime records and rejects corrupt packs', () => {
  fs.mkdirSync(root, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, 'android-assets-'));
  try {
    const packs = path.join(fixture, 'pack');
    const source = path.join(packs, 'engine-bay/1');
    fs.mkdirSync(source, { recursive: true });
    const records = {};
    for (const name of ['cloud', 'labels']) {
      const bytes = name === 'labels' ? Buffer.alloc(19) : Buffer.from(name);
      fs.writeFileSync(path.join(source, name), bytes);
      records[name] = {
        path: name,
        bytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      };
    }
    const manifest = {
      packId: 'engine-bay',
      packVersion: 1,
      tiers: [{ ...records, splatCount: 3 }],
      sources: { path: '.sources/private.npy' },
    };
    fs.writeFileSync(
      path.join(source, 'manifest.json'),
      JSON.stringify(manifest),
    );
    fs.writeFileSync(path.join(source, 'export.lock'), 'private');
    for (const name of ['.sources', 'releases']) {
      fs.mkdirSync(path.join(packs, name));
      fs.writeFileSync(path.join(packs, name, 'private'), 'private');
    }
    const destination = path.join(fixture, 'assets');
    prepareAssets(destination, packs);
    assert.deepEqual(fs.readdirSync(path.join(destination, 'packs')), [
      'engine-bay',
    ]);
    assert.deepEqual(
      fs.readdirSync(path.join(destination, 'packs/engine-bay/1')).sort(),
      ['cloud', 'labels', 'manifest.json'],
    );
    assert.ok(fs.existsSync(path.join(destination, 'fonts/Geist-Regular.ttf')));
    const notices = fs.readFileSync(
      path.join(destination, 'ThirdPartyNotices.txt'),
      'utf8',
    );
    assert.match(notices, /React Native and Yoga/);
    assert.match(notices, /Vulkan Memory Allocator/);
    assert.match(notices, /Fresco/);
    assert.doesNotMatch(notices, /Kokoro model/);
    manifest.tiers[0].splatCount = 4;
    fs.writeFileSync(
      path.join(source, 'manifest.json'),
      JSON.stringify(manifest),
    );
    assert.throws(() => prepareAssets(destination, packs), /count mismatch/);
    manifest.tiers[0].splatCount = 3;
    fs.writeFileSync(
      path.join(source, 'manifest.json'),
      JSON.stringify(manifest),
    );
    fs.writeFileSync(path.join(source, 'labels'), 'wrong');
    assert.throws(() => prepareAssets(destination, packs), /digest mismatch/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
