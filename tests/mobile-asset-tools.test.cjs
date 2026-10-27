const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  prepare,
  assemblyOrder,
  bakeLayer,
  archiveResources,
} = require('../scripts/prepare_ar_assembly.cjs');
const {
  copyAssembly,
} = require('../apps/field-guide/scripts/copy_ar_assembly.cjs');
const {
  fetchModels,
} = require('../apps/field-guide/scripts/fetch-kokoro-models.cjs');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fixture = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'field-guide-assets-'));
const layer = `#usda 1.0
(
    defaultPrim = "Assembly"
    startTimeCode = 0
    endTimeCode = 20
    metersPerUnit = 1
    upAxis = "Y"
)
def Xform "Assembly"
{
    def Xform "Late"
    {
        double3 xformOp:translate.timeSamples = {
            0: (0, 5, 0),
            20: (0, 0, 0),
        }
        uniform token[] xformOpOrder = ["xformOp:translate"]
        def Mesh "Mesh"
        {
            point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
            int[] faceVertexCounts = [3]
            int[] faceVertexIndices = [0, 1, 2]
        }
    }
    def Xform "Early"
    {
        double3 xformOp:translate.timeSamples = {
            0: (0, 2, 0),
            10: (0, 0, 0),
            20: (0, 0, 0),
        }
        uniform token[] xformOpOrder = ["xformOp:translate"]
        def Mesh "Mesh"
        {
            point3f[] points = [(0, 0, 0), (-1, 0, 0), (0, -1, 0)]
            int[] faceVertexCounts = [3]
            int[] faceVertexIndices = [0, 1, 2]
        }
    }
}
`;

test(
  'USDZ preparation retains independent names, settled transforms and source identities',
  { skip: process.platform !== 'darwin' },
  () => {
    const root = fixture();
    try {
      fs.writeFileSync(path.join(root, 'source.usda'), layer);
      const source = path.join(root, 'source.usdz'),
        output = path.join(root, 'prepared.usdz');
      execFileSync(
        'usdzip',
        [source, '--arkitAsset', path.join(root, 'source.usda')],
        { stdio: 'pipe' },
      );
      const alias = path.join(root, 'source-alias.usdz');
      fs.symlinkSync(source, alias);
      assert.throws(
        () => prepare(source, alias, path.join(root, 'receipt.json')),
        /distinct paths/,
      );
      const metadata = prepare(source, output, path.join(root, 'receipt.json'));
      assert.deepEqual(metadata.assemblyOrder, ['Early', 'Late']);
      assert.equal(metadata.bakedAttributeCount, 2);
      assert.equal(metadata.metersPerUnit, 1);
      assert.equal(metadata.sourceSha256, digest(fs.readFileSync(source)));
      assert.equal(metadata.preparedSha256, digest(fs.readFileSync(output)));
      const baked = execFileSync('usdcat', [output], { encoding: 'utf8' });
      assert.doesNotMatch(baked, /timeSamples/);
      assert.match(baked, /def Xform "Early"/);
      assert.match(baked, /xformOp:translate = \(0, 0, 0\)/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test('assembly preparation rejects an unfinished pose and ambiguous part identities', () => {
  assert.throws(() => bakeLayer(layer, 10), /samples after/);
  assert.throws(
    () => assemblyOrder(layer.replace('"Early"', '"Late"')),
    /unique/,
  );
  assert.equal(bakeLayer(layer).count, 2);
});

test('USDZ extraction rejects parent traversal and symbolic links before writing resources', () => {
  const root = fixture();
  try {
    for (const [name, mode] of [
      ['../outside.png', 0],
      ['safe.png', 0xa1ff],
    ]) {
      const filename = Buffer.from(name),
        local = Buffer.alloc(30),
        central = Buffer.alloc(46),
        end = Buffer.alloc(22);
      local.writeUInt32LE(0x04034b50);
      local.writeUInt16LE(filename.length, 26);
      central.writeUInt32LE(0x02014b50);
      central.writeUInt16LE(filename.length, 28);
      central.writeUInt16LE(mode, 40);
      end.writeUInt32LE(0x06054b50);
      end.writeUInt16LE(1, 8);
      end.writeUInt16LE(1, 10);
      end.writeUInt32LE(central.length + filename.length, 12);
      end.writeUInt32LE(local.length + filename.length, 16);
      const archive = path.join(root, 'unsafe.usdz');
      fs.writeFileSync(
        archive,
        Buffer.concat([local, filename, central, filename, end]),
      );
      assert.throws(() => archiveResources(archive), /unsafe resource/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('assembly bundling checks exact bytes and removes stale unavailable resources', () => {
  const root = fixture();
  try {
    const ios = path.join(root, 'apps/field-guide/ios'),
      assets = path.join(root, 'apps/field-guide/assets/ar');
    fs.mkdirSync(ios, { recursive: true });
    fs.mkdirSync(assets, { recursive: true });
    const bytes = Buffer.from('prepared assembly');
    const metadata = {
      preparedPath: 'prepared.usdz',
      modelPath: 'ar/engine.usdz',
      preparedByteLength: bytes.length,
      preparedSha256: digest(bytes),
      partCount: 2,
    };
    fs.writeFileSync(
      path.join(assets, 'v8-engine.json'),
      JSON.stringify(metadata),
    );
    const source = path.join(root, metadata.preparedPath);
    fs.writeFileSync(source, bytes);
    const env = {
      SRCROOT: ios,
      TARGET_BUILD_DIR: path.join(root, 'build'),
      UNLOCALIZED_RESOURCES_FOLDER_PATH: 'App.app',
    };
    const destination = path.join(
      env.TARGET_BUILD_DIR,
      env.UNLOCALIZED_RESOURCES_FOLDER_PATH,
      metadata.modelPath,
    );
    copyAssembly(env);
    assert.deepEqual(fs.readFileSync(destination), bytes);
    fs.writeFileSync(source, 'damaged');
    assert.throws(() => copyAssembly(env), /does not match/);
    fs.rmSync(source);
    copyAssembly(env);
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Kokoro fetches pinned bytes once, verifies cache offline and carries licenses', async () => {
  const root = fixture();
  try {
    const bytes = Buffer.from('model fixture'),
      destination = path.join(root, 'resources'),
      manifest = path.join(root, 'manifest.json'),
      licenseDirectory = path.join(root, 'licenses');
    fs.mkdirSync(licenseDirectory);
    fs.writeFileSync(
      path.join(licenseDirectory, 'MODEL.txt'),
      'license fixture',
    );
    fs.writeFileSync(
      manifest,
      JSON.stringify([
        {
          url: 'https://example.invalid/model',
          path: 'encoder/model.bin',
          sha256: digest(bytes),
        },
      ]),
    );
    let calls = 0;
    const options = {
      destination,
      manifest,
      licenseDirectory,
      retryPause: async () => {},
      fetchImpl: async () => {
        calls++;
        return new Response(bytes);
      },
    };
    assert.equal(await fetchModels(options), bytes.length);
    assert.equal(calls, 1);
    assert.equal(
      fs.readFileSync(path.join(destination, 'MODEL.txt'), 'utf8'),
      'license fixture',
    );
    await fetchModels({
      ...options,
      verifyOnly: true,
      fetchImpl: async () => {
        throw new Error('network forbidden');
      },
    });
    fs.writeFileSync(path.join(destination, 'encoder/model.bin'), 'damaged');
    await assert.rejects(
      fetchModels({ ...options, verifyOnly: true }),
      /Missing or damaged/,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      fetchModels({
        ...options,
        fetchImpl: async () => new Response('wrong digest'),
      }),
      /SHA-256 mismatch/,
    );
    assert.deepEqual(fs.readdirSync(path.join(destination, 'encoder')), [
      'model.bin',
    ]);
    assert.equal(
      fs.existsSync(path.join(root, '.kokoro-fetch-node.lock')),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
