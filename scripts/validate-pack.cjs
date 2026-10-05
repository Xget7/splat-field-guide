// Load the consumer's TypeScript rules directly; there is no second manifest schema.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'apps/field-guide/node_modules/typescript'));
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(output.outputText, filename);
};
const { parsePack } = require(path.join(ROOT, 'apps/field-guide/src/domain/parsePack.ts'));

function parse(value) {
  const result = parsePack(value);
  if (!result.ok) throw new Error(`${result.error.code} at ${result.error.path}: ${result.error.message}`);
  return result.pack;
}

function verify(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const pack = parse(manifest);
  const files = new Set();
  for (const tier of pack.tiers) {
    const bytes = {};
    for (const kind of ['cloud', 'labels']) {
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
    const cloud = zlib.gunzipSync(bytes.cloud);
    const labels = bytes.labels;
    const count = tier.splatCount;
    if (cloud.length < 16 || cloud.readUInt32LE(0) !== 0x5053474e || cloud.readUInt32LE(4) !== 3 ||
        cloud.readUInt32LE(8) !== count || cloud[14] !== 0 || cloud[15] !== 0 || cloud[12] > 3 || cloud[13] > 23) {
      throw new Error('invalid SPZ v3 header');
    }
    const coefficients = (cloud[12] + 1) ** 2 - 1;
    if (cloud.length !== 16 + count * (20 + 3 * coefficients)) throw new Error('invalid SPZ payload length');
    if (labels.length !== 16 + count || labels.toString('ascii', 0, 4) !== 'SFGL' ||
        labels.readUInt16LE(4) !== 1 || labels.readUInt16LE(6) !== 1 ||
        labels.readUInt32LE(8) !== count || labels.readUInt32LE(12) !== 0) {
      throw new Error('invalid labels header or count');
    }
    const known = new Set([0, ...pack.parts.map(part => part.label)]);
    for (const label of labels.subarray(16)) if (!known.has(label)) throw new Error(`unknown part label ${label}`);
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
