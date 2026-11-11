const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  prepareAssets,
} = require('../../../apps/field-guide/scripts/prepare-android-assets.cjs');

const root = path.resolve(__dirname, '../build');

test('Android defaults to no pack, with explicit verified pack selection available', () => {
  fs.mkdirSync(root, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, 'android-assets-'));
  try {
    const packs = path.join(fixture, 'pack');
    const destination = path.join(fixture, 'assets');
    // Missing content is normal for the empty app.
    prepareAssets(destination, packs);
    assert.deepEqual(fs.readdirSync(path.join(destination, 'packs')), []);
    assert.ok(fs.existsSync(path.join(destination, 'fonts/Geist-Regular.ttf')));
    const notices = fs.readFileSync(
      path.join(destination, 'ThirdPartyNotices.txt'),
      'utf8',
    );
    for (const title of [
      'React Native and Yoga',
      'Vulkan Memory Allocator',
      'PicoSHA2',
      'Fresco',
    ])
      assert.ok(notices.includes(title));
    assert.doesNotMatch(notices, /Kokoro model/);
    const manifest = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          '../../../tests/fixtures/runtime-manifest.json',
        ),
      ),
    );
    const source = path.join(packs, 'test-rig/1');
    const world = Buffer.alloc(128);
    world.write('LODSPLAT');
    world.writeUInt32LE(1, 8);
    world.writeUInt32LE(1, 12);
    world.writeUInt32LE(1, 16);
    const labels = Buffer.alloc(18);
    labels.write('SFGL');
    labels.writeUInt16LE(2, 4);
    labels.writeUInt16LE(2, 6);
    labels.writeUInt32LE(1, 8);
    for (const [name, bytes] of [
      ['world', world],
      ['labels', labels],
    ]) {
      const record = manifest.tiers[0][name];
      record.bytes = bytes.length;
      record.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      fs.mkdirSync(path.dirname(path.join(source, record.path)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(source, record.path), bytes);
    }
    fs.writeFileSync(
      path.join(source, 'manifest.json'),
      JSON.stringify(manifest),
    );
    prepareAssets(destination, packs);
    assert.deepEqual(fs.readdirSync(path.join(destination, 'packs')), []);
    prepareAssets(destination, packs, ['test-rig/1']);
    assert.ok(
      fs.existsSync(
        path.join(destination, 'packs/test-rig/1/high/world.lodsplat'),
      ),
    );
    fs.writeFileSync(path.join(source, manifest.tiers[0].labels.path), 'wrong');
    assert.throws(
      () => prepareAssets(destination, packs, ['test-rig/1']),
      /byte count|digest/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
