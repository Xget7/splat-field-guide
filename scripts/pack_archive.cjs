// Prepare the pinned runtime pack without importing capture or training tooling.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { isDeepStrictEqual } = require('node:util');
const { verify, parse } = require('./validate-pack.cjs');

const ROOT = path.resolve(__dirname, '..');
const PACK_ID = 'gol-trend-engine-bay';
const VERSION = 1;
const DESTINATION = path.join(ROOT, 'data/pack', PACK_ID, String(VERSION));
const MANIFEST = 'manifest.json';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const BLOCK = 512;

function releaseManifest() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'content', PACK_ID, MANIFEST), 'utf8'),
  );
  parse(manifest);
  return manifest;
}

function entries(manifest) {
  const files = new Map([[MANIFEST, MAX_MANIFEST_BYTES]]);
  for (const tier of manifest.tiers)
    for (const kind of ['world', 'labels']) {
      const entry = tier[kind];
      if (files.has(entry.path)) throw new Error('pack file paths repeat');
      files.set(entry.path, entry.bytes);
    }
  return files;
}

function validate(directory, manifest) {
  if (
    !isDeepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(directory, MANIFEST), 'utf8')),
      manifest,
    )
  ) {
    throw new Error(
      'pack manifest differs from the release pinned by this checkout',
    );
  }
  verify(directory);
}

function octal(header, start, length) {
  const value = header
    .subarray(start, start + length)
    .toString('ascii')
    .replace(/\0.*$/, '')
    .trim();
  if (!/^[0-7]+$/.test(value)) throw new Error('invalid tar numeric field');
  const number = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(number))
    throw new Error('tar numeric field exceeds safe range');
  return number;
}

function headerName(header) {
  const text = (start, length) =>
    header
      .subarray(start, start + length)
      .toString('utf8')
      .replace(/\0.*$/, '');
  const prefix = text(345, 155);
  return (prefix ? prefix + '/' : '') + text(0, 100);
}

// Parse the small USTAR subset we publish, rejecting links and extension records before writing.
async function unpack(archive, destination, manifest) {
  const wanted = entries(manifest);
  const directories = new Set(
    [...wanted.keys()].flatMap(name => {
      const parents = [];
      for (
        let parent = path.posix.dirname(name);
        parent !== '.';
        parent = path.posix.dirname(parent)
      )
        parents.push(parent);
      return parents;
    }),
  );
  const input = fs.createReadStream(archive);
  const expanded = input.pipe(zlib.createGunzip());
  input.on('error', error => expanded.destroy(error));
  const iterator = expanded[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  let total = 0;
  const limit =
    [...wanted.values()].reduce((sum, size) => sum + size, 0) +
    (wanted.size + directories.size + 24) * BLOCK;
  async function take(size, eof = false) {
    const chunks = [];
    let remaining = size;
    while (remaining) {
      if (!pending.length) {
        const next = await iterator.next();
        if (next.done) {
          if (eof && remaining === size) return null;
          throw new Error('truncated tar archive');
        }
        pending = next.value;
        total += pending.length;
        if (total > limit)
          throw new Error('expanded archive exceeds its size limit');
      }
      const count = Math.min(remaining, pending.length);
      chunks.push(pending.subarray(0, count));
      pending = pending.subarray(count);
      remaining -= count;
    }
    return Buffer.concat(chunks, size);
  }
  const found = new Set();
  let zeros = 0;
  try {
    for (;;) {
      const header = await take(BLOCK, true);
      if (!header) break;
      if (header.every(value => value === 0)) {
        zeros += 1;
        continue;
      }
      if (zeros) throw new Error('archive has content after its end marker');
      const checksum = header.reduce(
        (sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value),
        0,
      );
      if (checksum !== octal(header, 148, 8))
        throw new Error('invalid tar checksum');
      const name = headerName(header);
      const type = header[156];
      const size = octal(header, 124, 12);
      if (type === 53) {
        if (size || !directories.has(name.replace(/\/$/, '')))
          throw new Error(`unexpected archive directory ${name}`);
        continue;
      }
      if ((type !== 0 && type !== 48) || !wanted.has(name) || found.has(name))
        throw new Error(`unexpected archive entry ${name}`);
      if (
        size > wanted.get(name) ||
        (name !== MANIFEST && size !== wanted.get(name))
      )
        throw new Error(`archive byte count differs for ${name}`);
      const target = path.join(destination, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const output = fs.openSync(target, 'wx');
      try {
        for (let remaining = size; remaining; ) {
          const chunk = await take(Math.min(remaining, 65536));
          fs.writeFileSync(output, chunk);
          remaining -= chunk.length;
        }
      } finally {
        fs.closeSync(output);
      }
      if (size % BLOCK) await take(BLOCK - (size % BLOCK));
      found.add(name);
    }
    if (zeros < 2 || found.size !== wanted.size)
      throw new Error('archive is missing required pack files or end markers');
    validate(destination, manifest);
  } finally {
    input.destroy();
    expanded.destroy();
  }
}

async function download(url, target, limit) {
  if (url.includes('FILL_IN'))
    throw new Error('set FIELD_GUIDE_PACK_URL or pass --pack <archive>');
  const response = await fetch(url, {
    headers: { 'User-Agent': 'FieldGuide-prepare/1' },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok || !response.body)
    throw new Error(`pack download failed: HTTP ${response.status}`);
  const output = fs.openSync(target, 'wx');
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit)
        throw new Error('release archive exceeds its size limit');
      fs.writeFileSync(output, chunk);
    }
  } finally {
    fs.closeSync(output);
  }
}

async function ensure(archive, url, destination = DESTINATION) {
  const manifest = releaseManifest();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const lock = path.join(path.dirname(destination), '.prepare-node.lock');
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(`pack preparation is already locked: ${lock}`);
    throw error;
  }
  let candidate;
  const backup = `${destination}-previous-${crypto.randomUUID()}`;
  try {
    try {
      validate(destination, manifest);
      console.log('Demo pack already matches every pinned file digest.');
      return;
    } catch {}
    candidate = fs.mkdtempSync(path.join(path.dirname(destination), '.pack-'));
    if (!archive) {
      archive = path.join(candidate, '.download.tar.gz');
      await download(
        url,
        archive,
        [...entries(manifest).values()].reduce(
          (sum, size) => sum + size,
          MAX_MANIFEST_BYTES,
        ),
      );
      await unpack(archive, candidate, manifest);
      fs.unlinkSync(archive);
    } else await unpack(archive, candidate, manifest);
    const existed = fs.existsSync(destination);
    if (existed) fs.renameSync(destination, backup);
    try {
      fs.renameSync(candidate, destination);
    } catch (error) {
      if (existed) fs.renameSync(backup, destination);
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
    console.log(`Verified demo pack: ${destination}`);
  } finally {
    if (candidate) fs.rmSync(candidate, { recursive: true, force: true });
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function tarHeader(name, size) {
  if (Buffer.byteLength(name) > 100)
    throw new Error(`pack path exceeds USTAR name limit: ${name}`);
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 100);
  const number = (value, offset, length) => {
    const encoded = value.toString(8).padStart(length - 1, '0');
    if (encoded.length >= length)
      throw new Error('pack file exceeds USTAR size limit');
    header.write(encoded + '\0', offset, length, 'ascii');
  };
  number(0o644, 100, 8);
  number(0, 108, 8);
  number(0, 116, 8);
  number(size, 124, 12);
  number(0, 136, 12);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write('ustar\x0000', 257, 8, 'ascii');
  header.write(
    header
      .reduce((sum, value) => sum + value, 0)
      .toString(8)
      .padStart(6, '0') + '\0 ',
    148,
    8,
    'ascii',
  );
  return header;
}

async function packagePack(directory, archive) {
  const manifest = releaseManifest();
  validate(directory, manifest);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  const temporary = `${archive}.partial-${crypto.randomUUID()}`;
  async function* content() {
    for (const name of [...entries(manifest).keys()].sort()) {
      const file = path.join(directory, name);
      const size = fs.statSync(file).size;
      yield tarHeader(name, size);
      yield* fs.createReadStream(file);
      if (size % BLOCK) yield Buffer.alloc(BLOCK - (size % BLOCK));
    }
    yield Buffer.alloc(2 * BLOCK);
  }
  try {
    await pipeline(
      Readable.from(content()),
      zlib.createGzip(),
      fs.createWriteStream(temporary, { flags: 'wx' }),
    );
    const digest = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(temporary))
      digest.update(chunk);
    const checksum = digest.digest('hex');
    fs.renameSync(temporary, archive);
    fs.writeFileSync(
      archive + '.sha256',
      `${checksum}  ${path.basename(archive)}\n`,
    );
    console.log(`Pack archive: ${archive}\nSHA-256: ${checksum}`);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

module.exports = { ensure, unpack, packagePack, entries, tarHeader };
if (require.main === module) {
  const [stage, ...args] = process.argv.slice(2);
  const options = {};
  let valid = ['ensure', 'package'].includes(stage);
  for (let index = 0; index < args.length; index += 2) {
    if (
      !['--pack', '--url', '--out'].includes(args[index]) ||
      !args[index + 1] ||
      options[args[index]]
    )
      valid = false;
    options[args[index]] = args[index + 1];
  }
  if (!valid || (stage === 'ensure' && !options['--url'])) {
    console.error(
      'Usage: pack_archive.cjs ensure --url <url> [--pack <archive>] | package [--pack <directory>] [--out <archive>]',
    );
    process.exitCode = 2;
  } else {
    const operation =
      stage === 'ensure'
        ? ensure(options['--pack'], options['--url'])
        : packagePack(
            path.resolve(options['--pack'] || DESTINATION),
            path.resolve(
              options['--out'] ||
                path.join(
                  ROOT,
                  'data/pack/releases',
                  `${PACK_ID}-${VERSION}.tar.gz`,
                ),
            ),
          );
    operation.catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
