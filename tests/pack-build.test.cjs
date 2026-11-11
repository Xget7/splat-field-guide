const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { copyPacks } = require('../scripts/copy_bundled_packs.cjs');
const { tarHeader } = require('../scripts/pack_archive.cjs');
const { verify } = require('../scripts/validate-pack.cjs');
const ROOT = path.resolve(__dirname, '..');

function vectorBytes(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'field-guide-pack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
    return file;
  };
  for (const name of [
    'scripts/pack_archive.cjs',
    'scripts/validate-pack.cjs',
    'scripts/package-pack.sh',
    'apps/field-guide/src/features/pack/pack.ts',
    'apps/field-guide/src/features/pack/parsePack.ts',
    'apps/field-guide/src/features/pack/tour.ts',
  ])
    put(name, fs.readFileSync(path.join(ROOT, name)));
  fs.mkdirSync(path.join(root, 'apps/field-guide/node_modules'), {
    recursive: true,
  });
  fs.symlinkSync(
    path.join(ROOT, 'apps/field-guide/node_modules/typescript'),
    path.join(root, 'apps/field-guide/node_modules/typescript'),
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tests/fixtures/runtime-manifest.json')),
  );
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
  const tier = manifest.tiers[0];
  tier.nodeCount = tier.splatCount = 1;
  manifest.model = { path: 'semantic/model.ttl' };
  manifest.semantic = {
    space: {
      id: 'c'.repeat(64),
      encoder: 'test-encoder',
      weightsSha256: 'd'.repeat(64),
      preprocessing: 'test-crop',
      dimensions: 2,
      normalized: true,
    },
    vectors: { path: 'semantic/vectors.f32' },
    rows: [{ part: 'panel', kind: 'image' }],
  };
  const pack = 'data/pack/test-rig/1/';
  for (const [entry, bytes] of [
    [tier.world, world],
    [tier.labels, labels],
    [manifest.model, Buffer.from('<panel> a brick:Equipment .\n')],
    [manifest.semantic.vectors, vectorBytes([0.6, 0.8])],
  ]) {
    entry.bytes = bytes.length;
    entry.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    put(pack + entry.path, bytes);
  }
  put(pack + 'manifest.json', JSON.stringify(manifest));
  put('tests/fixtures/runtime-manifest.json', JSON.stringify(manifest));
  return { root, pack: path.join(root, pack), manifest, put };
}

function cli(root, ...args) {
  return spawnSync(
    process.execPath,
    [
      path.join(root, 'scripts/pack_archive.cjs'),
      ...args,
      '--manifest',
      path.join(root, 'tests/fixtures/runtime-manifest.json'),
    ],
    { encoding: 'utf8' },
  );
}

test('archive round trip is reproducible and cache recovery preserves a failed replacement', t => {
  const { root, pack, put } = fixture(t);
  const archive = path.join(root, 'release.tar.gz');
  const packageRun = () =>
    spawnSync(
      'sh',
      [
        path.join(root, 'scripts/package-pack.sh'),
        '--manifest',
        path.join(root, 'tests/fixtures/runtime-manifest.json'),
        '--pack',
        pack,
        '--out',
        archive,
      ],
      { encoding: 'utf8' },
    );
  let result = packageRun();
  assert.equal(result.status, 0, result.stderr);
  const first = fs.readFileSync(archive);
  assert.equal(packageRun().status, 0);
  assert.deepEqual(fs.readFileSync(archive), first);
  assert.equal(
    fs.readFileSync(archive + '.sha256', 'utf8').split(' ')[0],
    crypto.createHash('sha256').update(first).digest('hex'),
  );
  fs.rmSync(pack, { recursive: true });
  result = cli(
    root,
    'ensure',
    '--url',
    'https://unused.invalid',
    '--pack',
    archive,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    cli(
      root,
      'ensure',
      '--url',
      'https://unused.invalid',
      '--pack',
      path.join(root, 'missing'),
    ).status,
    0,
  );
  const damaged = put(
    'data/pack/test-rig/1/high/labels.bin',
    'damaged accepted cache',
  );
  const bad = put(
    'bad.tar.gz',
    zlib.gzipSync(
      Buffer.concat([tarHeader('../escape', 0), Buffer.alloc(1024)]),
    ),
  );
  result = cli(
    root,
    'ensure',
    '--url',
    'https://unused.invalid',
    '--pack',
    bad,
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected archive entry/);
  assert.equal(fs.readFileSync(damaged, 'utf8'), 'damaged accepted cache');
  assert.equal(fs.existsSync(path.join(root, 'data/pack/escape')), false);
  result = cli(
    root,
    'ensure',
    '--url',
    'https://unused.invalid',
    '--pack',
    archive,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('archive rejects links, duplicate files, wrong lengths and manifest drift', t => {
  const { root, pack, manifest, put } = fixture(t);
  fs.rmSync(pack, { recursive: true });
  const link = tarHeader('manifest.json', 0);
  link[156] = 50;
  link.fill(32, 148, 156);
  link.write(
    link
      .reduce((sum, value) => sum + value, 0)
      .toString(8)
      .padStart(6, '0') + '\0 ',
    148,
    8,
    'ascii',
  );
  const duplicate = Buffer.concat([
    tarHeader('manifest.json', 0),
    tarHeader('manifest.json', 0),
  ]);
  for (const [name, payload, reason] of [
    ['link', link, /unexpected archive entry/],
    ['duplicate', duplicate, /unexpected archive entry/],
    [
      'length',
      tarHeader(manifest.tiers[0].world.path, 1),
      /archive byte count/,
    ],
    [
      'extension',
      (() => {
        const h = Buffer.from(link);
        h[156] = 120;
        h.fill(32, 148, 156);
        h.write(
          h
            .reduce((s, v) => s + v, 0)
            .toString(8)
            .padStart(6, '0') + '\0 ',
          148,
          8,
        );
        return h;
      })(),
      /unexpected archive entry/,
    ],
  ]) {
    const archive = put(
      name + '.tar.gz',
      zlib.gzipSync(Buffer.concat([payload, Buffer.alloc(1024)])),
    );
    const result = cli(
      root,
      'ensure',
      '--url',
      'https://unused.invalid',
      '--pack',
      archive,
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, reason);
    assert.equal(fs.existsSync(pack), false);
  }
  manifest.title = 'Different release';
  put('data/pack/test-rig/1/manifest.json', JSON.stringify(manifest));
  const result = cli(
    root,
    'package',
    '--pack',
    pack,
    '--out',
    path.join(root, 'wrong.tar.gz'),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest differs/);
});

test('bundling includes only runtime files and preserves unchanged mtimes', t => {
  const { root, pack, put, manifest } = fixture(t);
  put('data/pack/test-rig/1/unreferenced.bin', 'not runtime');
  put('data/pack/releases/demo.tar.gz', 'not runtime');
  const destination = path.join(root, 'build/packs');
  put('build/packs/stale.bin', 'stale');
  copyPacks(path.join(root, 'data/pack'), destination, ['test-rig/1']);
  const runtime = path.join(destination, 'test-rig/1');
  assert.deepEqual(fs.readdirSync(runtime).sort(), [
    'high',
    'manifest.json',
    'semantic',
  ]);
  assert.deepEqual(fs.readdirSync(path.join(runtime, 'high')).sort(), [
    'labels.bin',
    'world.lodsplat',
  ]);
  assert.deepEqual(fs.readdirSync(path.join(runtime, 'semantic')).sort(), [
    'model.ttl',
    'vectors.f32',
  ]);
  assert.equal(fs.existsSync(path.join(destination, 'stale.bin')), false);
  const before = fs.statSync(path.join(runtime, 'high/world.lodsplat')).mtimeMs;
  copyPacks(path.join(root, 'data/pack'), destination, ['test-rig/1']);
  assert.equal(
    fs.statSync(path.join(runtime, 'high/world.lodsplat')).mtimeMs,
    before,
  );
  assert.throws(
    () => copyPacks(path.join(root, 'data/pack'), destination, ['../escape']),
    /invalid bundled/,
  );
  fs.unlinkSync(path.join(pack, manifest.tiers[0].labels.path));
  fs.symlinkSync(
    path.join(pack, manifest.tiers[0].world.path),
    path.join(pack, manifest.tiers[0].labels.path),
  );
  assert.throws(
    () => copyPacks(path.join(root, 'data/pack'), destination, ['test-rig/1']),
    /linked runtime/,
  );
  assert.equal(
    fs.statSync(path.join(runtime, 'high/world.lodsplat')).mtimeMs,
    before,
  );
});

test('bundling rejects damaged source bytes before modifying the accepted bundle', t => {
  const { root, pack, manifest } = fixture(t);
  const source = path.join(root, 'data/pack');
  const destination = path.join(root, 'build/packs');
  copyPacks(source, destination, ['test-rig/1']);
  const label = manifest.tiers[0].labels.path;
  const accepted = fs.readFileSync(path.join(destination, 'test-rig/1', label));
  fs.writeFileSync(path.join(pack, label), Buffer.alloc(accepted.length, 42));
  assert.throws(
    () => copyPacks(source, destination, ['test-rig/1']),
    /sha256 mismatch/,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(destination, 'test-rig/1', label)),
    accepted,
  );
});

test('bundling repairs damaged destination bytes even when size and timestamp match', t => {
  const { root, manifest } = fixture(t);
  const source = path.join(root, 'data/pack');
  const destination = path.join(root, 'build/packs');
  copyPacks(source, destination, ['test-rig/1']);
  const relative = path.join('test-rig/1', manifest.tiers[0].labels.path);
  const original = fs.statSync(path.join(source, relative));
  const target = path.join(destination, relative);
  fs.writeFileSync(target, Buffer.alloc(original.size, 42));
  fs.utimesSync(target, original.atime, original.mtime);
  copyPacks(source, destination, ['test-rig/1']);
  assert.deepEqual(
    fs.readFileSync(target),
    fs.readFileSync(path.join(source, relative)),
  );
});

test('pack verification checks the model and vector files like tier files', t => {
  const { pack, manifest } = fixture(t);
  assert.deepEqual(verify(pack).files.sort(), [
    'high/labels.bin',
    'high/world.lodsplat',
    'semantic/model.ttl',
    'semantic/vectors.f32',
  ]);
  const model = fs.readFileSync(path.join(pack, manifest.model.path));
  fs.writeFileSync(
    path.join(pack, manifest.model.path),
    Buffer.alloc(model.length, 42),
  );
  assert.throws(() => verify(pack), /sha256 mismatch: semantic\/model.ttl/);
  fs.writeFileSync(path.join(pack, manifest.model.path), model);
  const vectors = manifest.semantic.vectors;
  fs.writeFileSync(path.join(pack, vectors.path), vectorBytes([0.6, 0.8, 0]));
  assert.throws(() => verify(pack), /byte count mismatch: semantic\/vectors/);
  const unnormalized = vectorBytes([1, 1]);
  fs.writeFileSync(path.join(pack, vectors.path), unnormalized);
  vectors.sha256 = crypto
    .createHash('sha256')
    .update(unnormalized)
    .digest('hex');
  fs.writeFileSync(path.join(pack, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => verify(pack), /vector row 0 is not normalized/);
});

test('pack verification rejects linked manifests and linked runtime directories', t => {
  for (const linked of ['manifest.json', 'high']) {
    const { root, pack } = fixture(t);
    const target = path.join(pack, linked);
    const outside = path.join(root, 'linked-' + linked);
    fs.renameSync(target, outside);
    fs.symlinkSync(outside, target);
    const result = cli(
      root,
      'package',
      '--pack',
      pack,
      '--out',
      path.join(root, 'linked.tar.gz'),
    );
    assert.notEqual(result.status, 0, linked);
    assert.match(result.stderr, /symlink in pack/);
  }
});

test('empty selection bundles no implicit pack and clears stale runtime files', t => {
  const { root, put } = fixture(t);
  const destination = path.join(root, 'empty-bundle');
  put('empty-bundle/stale.bin', 'stale');
  copyPacks(path.join(root, 'absent'), destination, []);
  assert.deepEqual(fs.readdirSync(destination), []);
});

test('archive commands require explicit manifest and pack inputs', t => {
  const { root } = fixture(t);
  for (const stage of ['ensure', 'package']) {
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/pack_archive.cjs'), stage],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--manifest/);
  }
});

test('validator preserves uint16 labels and rejects unknown labels and old SFGL', t => {
  const { pack, manifest } = fixture(t);
  const tier = manifest.tiers[0];
  manifest.parts[0].label = 65535;
  const labels = fs.readFileSync(path.join(pack, tier.labels.path));
  const save = () => {
    tier.labels.sha256 = crypto
      .createHash('sha256')
      .update(labels)
      .digest('hex');
    fs.writeFileSync(path.join(pack, tier.labels.path), labels);
    fs.writeFileSync(
      path.join(pack, 'manifest.json'),
      JSON.stringify(manifest),
    );
  };
  labels.writeUInt16LE(65535, 16);
  save();
  assert.equal(verify(pack).packId, manifest.packId);
  labels.writeUInt16LE(65534, 16);
  save();
  assert.throws(() => verify(pack), /unknown part label 65534/);
  labels.writeUInt16LE(1, 4);
  labels.writeUInt16LE(1, 6);
  save();
  assert.throws(() => verify(pack), /SFGL v2/);
});
