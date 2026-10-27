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
const ROOT = path.resolve(__dirname, '..');

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
    'apps/field-guide/src/features/guide/tour.ts',
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
    fs.readFileSync(
      path.join(ROOT, 'content/gol-trend-engine-bay/manifest.json'),
    ),
  );
  const world = Buffer.alloc(128);
  world.write('LODSPLAT');
  world.writeUInt32LE(1, 8);
  world.writeUInt32LE(1, 12);
  world.writeUInt32LE(1, 16);
  const labels = Buffer.alloc(17);
  labels.write('SFGL');
  labels.writeUInt16LE(1, 4);
  labels.writeUInt16LE(1, 6);
  labels.writeUInt32LE(1, 8);
  const tier = manifest.tiers[0];
  tier.nodeCount = tier.splatCount = 1;
  const pack = 'data/pack/gol-trend-engine-bay/1/';
  for (const [kind, bytes] of [
    ['world', world],
    ['labels', labels],
  ]) {
    tier[kind].bytes = bytes.length;
    tier[kind].sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    put(pack + tier[kind].path, bytes);
  }
  put(pack + 'manifest.json', JSON.stringify(manifest));
  put('content/gol-trend-engine-bay/manifest.json', JSON.stringify(manifest));
  return { root, pack: path.join(root, pack), manifest, put };
}

function cli(root, ...args) {
  return spawnSync(
    process.execPath,
    [path.join(root, 'scripts/pack_archive.cjs'), ...args],
    { encoding: 'utf8' },
  );
}

test('archive round trip is reproducible and cache recovery preserves a failed replacement', t => {
  const { root, pack, put } = fixture(t);
  const archive = path.join(root, 'release.tar.gz');
  const packageRun = () =>
    spawnSync(
      'sh',
      [path.join(root, 'scripts/package-pack.sh'), '--out', archive],
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
    'data/pack/gol-trend-engine-bay/1/high/labels.bin',
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
  put(
    'data/pack/gol-trend-engine-bay/1/manifest.json',
    JSON.stringify(manifest),
  );
  const result = cli(root, 'package', '--out', path.join(root, 'wrong.tar.gz'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest differs/);
});

test('bundling includes only runtime files and preserves unchanged mtimes', t => {
  const { root, pack, put, manifest } = fixture(t);
  put('data/pack/gol-trend-engine-bay/1/unreferenced.bin', 'not runtime');
  put('data/pack/releases/demo.tar.gz', 'not runtime');
  const destination = path.join(root, 'build/packs');
  put('build/packs/stale.bin', 'stale');
  copyPacks(path.join(root, 'data/pack'), destination, [
    'gol-trend-engine-bay/1',
  ]);
  const runtime = path.join(destination, 'gol-trend-engine-bay/1');
  assert.deepEqual(fs.readdirSync(runtime).sort(), ['high', 'manifest.json']);
  assert.deepEqual(fs.readdirSync(path.join(runtime, 'high')).sort(), [
    'labels.bin',
    'world.lodsplat',
  ]);
  assert.equal(fs.existsSync(path.join(destination, 'stale.bin')), false);
  const before = fs.statSync(path.join(runtime, 'high/world.lodsplat')).mtimeMs;
  copyPacks(path.join(root, 'data/pack'), destination, [
    'gol-trend-engine-bay/1',
  ]);
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
    () =>
      copyPacks(path.join(root, 'data/pack'), destination, [
        'gol-trend-engine-bay/1',
      ]),
    /linked runtime/,
  );
  assert.equal(
    fs.statSync(path.join(runtime, 'high/world.lodsplat')).mtimeMs,
    before,
  );
});
