// Load the consumer's TypeScript rules directly, including required schema 3 view directions.
// There is no second manifest schema.
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

function readPackFile(directory, relative) {
  // lstat every component: checking only the leaf still follows linked tier directories.
  let filename = directory;
  for (const part of ['', ...relative.split('/')]) {
    filename = path.join(filename, part);
    if (fs.lstatSync(filename).isSymbolicLink()) throw new Error(`symlink in pack: ${relative}`);
  }
  if (!fs.statSync(filename).isFile()) throw new Error(`not a pack file: ${relative}`);
  return fs.readFileSync(filename);
}

// Every file a pack ships besides its manifest: tier trees and labels, the Brick model and vectors.
function packFiles(pack) {
  return [
    ...pack.tiers.flatMap(tier => [tier.world, tier.labels]),
    ...(pack.model ? [pack.model] : []),
    ...(pack.semantic ? [pack.semantic.vectors] : []),
  ];
}

// Preparation writes unit vectors; float32 rounding leaves a small error in each norm.
const UNIT_NORM_TOLERANCE = 1e-3;

function checkVectors(data, semantic) {
  const { dimensions } = semantic.space;
  for (let row = 0; row < semantic.rows.length; row += 1) {
    let sum = 0;
    for (let index = 0; index < dimensions; index += 1) {
      const value = data.readFloatLE((row * dimensions + index) * 4);
      if (!Number.isFinite(value)) throw new Error(`non-finite vector value in row ${row}`);
      sum += value * value;
    }
    if (Math.abs(Math.sqrt(sum) - 1) > UNIT_NORM_TOLERANCE) throw new Error(`vector row ${row} is not normalized`);
  }
}

function verify(directory) {
  const manifest = JSON.parse(readPackFile(directory, 'manifest.json').toString('utf8'));
  const pack = parse(manifest);
  const contents = new Map();
  for (const entry of packFiles(pack)) {
    if (contents.has(entry.path)) throw new Error(`pack file paths repeat: ${entry.path}`);
    const data = readPackFile(directory, entry.path);
    if (data.length !== entry.bytes) throw new Error(`byte count mismatch: ${entry.path}`);
    if (crypto.createHash('sha256').update(data).digest('hex') !== entry.sha256) {
      throw new Error(`sha256 mismatch: ${entry.path}`);
    }
    contents.set(entry.path, data);
  }
  if (pack.semantic) checkVectors(contents.get(pack.semantic.vectors.path), pack.semantic);
  for (const tier of pack.tiers) {
    checkWorld(contents.get(tier.world.path), tier);
    // One label per tree node, in node order.
    const labels = contents.get(tier.labels.path);
    const count = tier.nodeCount;
    if (labels.length !== LABELS_HEADER_BYTES + count * 2 || labels.toString('ascii', 0, 4) !== 'SFGL' ||
        labels.readUInt16LE(4) !== 2 || labels.readUInt16LE(6) !== 2 ||
        labels.readUInt32LE(8) !== count || labels.readUInt32LE(12) !== 0) {
      throw new Error('invalid SFGL v2 uint16 labels header or count');
    }
    const known = new Set([0, ...pack.parts.map(part => part.label)]);
    for (let index = 0; index < count; index += 1) {
      const label = labels.readUInt16LE(LABELS_HEADER_BYTES + index * 2);
      if (!known.has(label)) throw new Error(`unknown part label ${label}`);
    }
  }
  return { packId: pack.packId, packVersion: pack.packVersion, files: [...contents.keys()] };
}

module.exports = { parse, verify, packFiles };
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
