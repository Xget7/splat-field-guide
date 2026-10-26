// Load the consumer's TypeScript rules directly; there is no second manifest schema.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'apps/field-guide/node_modules/typescript'));
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(output.outputText, filename);
};
const { parsePack } = require(path.join(ROOT, 'apps/field-guide/src/features/pack/parsePack.ts'));

function parse(value) {
  const result = parsePack(value);
  if (!result.ok) throw new Error(`${result.error.code} at ${result.error.path}: ${result.error.message}`);
  return result.pack;
}

// SplatKit's LODSPLAT layout, from splat-core lod/LodFile.cpp.
const LODSPLAT_MAGIC = 'LODSPLAT';
const LODSPLAT_HEADER_BYTES = 64;
const LODSPLAT_NODE_BYTES = 64;
const LODSPLAT_CLUSTER_BYTES = 64;
const LODSPLAT_LEAF_REF_BYTES = 4;
const LABELS_HEADER_BYTES = 16;

function checkWorld(world, tier) {
  if (world.length < LODSPLAT_HEADER_BYTES || world.toString('ascii', 0, 8) !== LODSPLAT_MAGIC) {
    throw new Error('invalid LODSPLAT header');
  }
  const [version, nodes, leaves, degree] = [8, 12, 16, 20].map(offset => world.readUInt32LE(offset));
  const clusters = world.readUInt32LE(28);
  const leafRefs = world.readUInt32LE(56);
  if ((version !== 1 && version !== 2) || degree > 3 || nodes !== tier.nodeCount || leaves !== tier.splatCount) {
    throw new Error('LODSPLAT header differs from the tier');
  }
  const stride = LODSPLAT_NODE_BYTES + ((degree + 1) ** 2 - 1) * 3 * 4;
  const size = LODSPLAT_HEADER_BYTES + nodes * stride + clusters * LODSPLAT_CLUSTER_BYTES +
    leafRefs * LODSPLAT_LEAF_REF_BYTES;
  if (world.length !== size) throw new Error('invalid LODSPLAT length');
}

function verify(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const pack = parse(manifest);
  const files = new Set();
  for (const tier of pack.tiers) {
    const bytes = {};
    for (const kind of ['world', 'labels']) {
      const entry = tier[kind];
      const filename = path.join(directory, entry.path);
      if (fs.lstatSync(filename).isSymbolicLink()) throw new Error(`symlink in pack: ${entry.path}`);
      const data = fs.readFileSync(filename);
      if (data.length !== entry.bytes) throw new Error(`byte count mismatch: ${entry.path}`);
      if (crypto.createHash('sha256').update(data).digest('hex') !== entry.sha256) {
        throw new Error(`sha256 mismatch: ${entry.path}`);
      }
      files.add(entry.path);
      bytes[kind] = data;
    }
    checkWorld(bytes.world, tier);
    // One label per tree node, in node order.
    const labels = bytes.labels;
    const count = tier.nodeCount;
    if (labels.length !== LABELS_HEADER_BYTES + count || labels.toString('ascii', 0, 4) !== 'SFGL' ||
        labels.readUInt16LE(4) !== 1 || labels.readUInt16LE(6) !== 1 ||
        labels.readUInt32LE(8) !== count || labels.readUInt32LE(12) !== 0) {
      throw new Error('invalid labels header or count');
    }
    const known = new Set([0, ...pack.parts.map(part => part.label)]);
    for (const label of labels.subarray(LABELS_HEADER_BYTES)) if (!known.has(label)) throw new Error(`unknown part label ${label}`);
  }
  return { packId: pack.packId, packVersion: pack.packVersion, files: [...files] };
}

module.exports = { parse, verify };
if (require.main === module) {
  try {
    const result = process.argv[2] === '--json'
      ? parse(JSON.parse(fs.readFileSync(0, 'utf8')))
      : verify(path.resolve(process.argv[2]));
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
