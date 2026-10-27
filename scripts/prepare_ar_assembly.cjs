#!/usr/bin/env node
// Bake the settled USDZ pose while retaining named parts and their authored order.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { inflateRawSync } = require('node:zlib');
const ASSEMBLED_TIME_CODE = 3250;
const ZIP_TIMESTAMP = new Date('1980-01-01T00:00:00Z');
const timeSamples = () =>
  /^([ ]+)(\w+(?:\[\])?) ([\w:]+)\.timeSamples = \{\n([\s\S]*?)^\1\}/gm;
const sha256 = file =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function sampleValues(body) {
  const values = [
    ...body.matchAll(
      /^ +([\deE+.-]+): (.*?)(?=^ +[\deE+.-]+: |$(?![\s\S]))/gms,
    ),
  ].map(match => [Number(match[1]), match[2].trim().replace(/,$/, '')]);
  if (!values.length || values.some(([time]) => !Number.isFinite(time)))
    throw new Error('Invalid or empty authored animation samples');
  return values.sort((a, b) => a[0] - b[0]);
}
function stabilizationTime(values) {
  let time = values.at(-1)[0];
  const value = values.at(-1)[1];
  for (let i = values.length - 2; i >= 0 && values[i][1] === value; i--)
    time = values[i][0];
  return time;
}
function assemblyOrder(layer) {
  const prims = [],
    ancestors = [];
  for (const match of layer.matchAll(/^( *)def (\w+) "([^"]+)"/gm)) {
    const indent = match[1].length;
    while (ancestors.length && ancestors.at(-1).indent >= indent)
      ancestors.pop();
    const prim = {
      name: match[3],
      indent,
      start: match.index,
      children: [],
      meshes: match[2] === 'Mesh',
    };
    if (ancestors.length) ancestors.at(-1).children.push(prim);
    prims.push(prim);
    ancestors.push(prim);
  }
  for (let i = 0; i < prims.length; i++)
    prims[i].end =
      prims.slice(i + 1).find(p => p.indent <= prims[i].indent)?.start ??
      layer.length;
  for (const prim of [...prims].reverse())
    prim.meshes ||= prim.children.some(p => p.meshes);
  let root = prims.find(p => p.meshes);
  if (!root) throw new Error('USDZ contains no renderable meshes');
  let parts;
  while ((parts = root.children.filter(p => p.meshes)).length === 1)
    root = parts[0];
  if (parts.length < 2)
    throw new Error('USDZ needs at least two independently named parts');
  if (new Set(parts.map(p => p.name)).size !== parts.length)
    throw new Error('USDZ part names must be unique');
  return parts
    .map((part, index) => {
      const movement = [
        ...layer.slice(part.start, part.end).matchAll(timeSamples()),
      ]
        .filter(match => match[3].startsWith('xformOp:'))
        .map(match => stabilizationTime(sampleValues(match[4])));
      return {
        name: part.name,
        index,
        arrival: movement.length ? Math.max(...movement) : -1,
      };
    })
    .sort((a, b) => a.arrival - b.arrival || a.index - b.index)
    .map(p => p.name);
}
function bakeLayer(layer, time = ASSEMBLED_TIME_CODE) {
  if (!Number.isFinite(time)) throw new Error('Sample time must be finite');
  let count = 0;
  let baked = layer.replace(
    timeSamples(),
    (_match, indent, type, attribute, body) => {
      const values = sampleValues(body);
      if (values.at(-1)[0] > time)
        throw new Error(`${attribute} has authored samples after ${time}`);
      count++;
      return `${indent}${type} ${attribute} = ${values.at(-1)[1]}`;
    },
  );
  if (baked.includes('.timeSamples'))
    throw new Error('Unsupported animation sample syntax');
  baked = baked.replace(
    /^ {4}(endTimeCode|startTimeCode|timeCodesPerSecond) = [^\n]+\n/gm,
    '',
  );
  return { layer: baked, count };
}
function layerMetadata(layer) {
  const result = {};
  for (const [source, key] of [
    ['author', 'author'],
    ['copyright', 'license'],
    ['url', 'sourceURL'],
  ]) {
    result[key] =
      layer.match(
        new RegExp(`^ {8}string ${source} = "([^"\\n]*)"`, 'm'),
      )?.[1] ?? null;
  }
  result.metersPerUnit = Number(
    layer.match(/^ {4}metersPerUnit = ([\deE+.-]+)/m)?.[1] ?? 0.01,
  );
  result.upAxis = layer.match(/^ {4}upAxis = "(\w+)"/m)?.[1] ?? 'Y';
  return result;
}
function archiveResources(file) {
  // Inspect central-directory types before extracting bytes, so links cannot escape staging.
  const bytes = fs.readFileSync(file);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (
      bytes.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + bytes.readUInt16LE(end + 20) === bytes.length
    )
      break;
  }
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50)
    throw new Error('Invalid USDZ archive');
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    throw new Error('Unsupported multi-disk USDZ');
  const entries = [],
    names = new Set();
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('Invalid USDZ directory');
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20),
      unpacked = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32);
    const mode = bytes.readUInt16LE(offset + 40),
      local = bytes.readUInt32LE(offset + 42);
    const name = bytes
      .subarray(offset + 46, offset + 46 + length)
      .toString('utf8');
    if (
      !name ||
      name.includes('\0') ||
      name.includes('\\') ||
      path.posix.isAbsolute(name) ||
      name.split('/').includes('..') ||
      Math.floor(mode / 0x1000) === 0xa ||
      names.has(name)
    )
      throw new Error('USDZ contains an unsafe resource path');
    names.add(name);
    if (flags % 2 || ![0, 8].includes(method))
      throw new Error('Unsupported USDZ compression');
    if (bytes.readUInt32LE(local) !== 0x04034b50)
      throw new Error('Invalid USDZ resource');
    const start =
      local +
      30 +
      bytes.readUInt16LE(local + 26) +
      bytes.readUInt16LE(local + 28);
    if (start + size > bytes.readUInt32LE(end + 16))
      throw new Error('Truncated USDZ resource');
    const data =
      method === 0
        ? bytes.subarray(start, start + size)
        : inflateRawSync(bytes.subarray(start, start + size));
    if (data.length !== unpacked) throw new Error('Invalid USDZ resource size');
    entries.push({ name, data });
    offset += 46 + length + extra + comment;
  }
  return entries;
}
function prepare(source, output, metadataOutput, time = ASSEMBLED_TIME_CODE) {
  source = fs.realpathSync(source);
  const canonicalDestination = file => {
    file = path.resolve(file);
    if (fs.existsSync(file)) return fs.realpathSync(file);
    const parent = path.dirname(file);
    return path.join(canonicalDestination(parent), path.basename(file));
  };
  output = canonicalDestination(output);
  metadataOutput = canonicalDestination(metadataOutput);
  if (
    path.extname(output) !== '.usdz' ||
    source === output ||
    [source, output].includes(metadataOutput)
  )
    throw new Error(
      'Source, prepared USDZ and metadata require distinct paths',
    );
  const run = (tool, args, options = {}) =>
    execFileSync(tool, args, { maxBuffer: 256 * 1024 * 1024, ...options });
  const original = run('usdcat', [source], { encoding: 'utf8' });
  const order = assemblyOrder(original),
    baked = bakeLayer(original, time);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staging = fs.mkdtempSync(
    path.join(path.dirname(output), 'ar-assembly-'),
  );
  try {
    const entries = archiveResources(source);
    const root = entries.find(entry =>
      ['.usd', '.usda', '.usdc'].includes(path.posix.extname(entry.name)),
    )?.name;
    if (!root) throw new Error('USDZ contains no root USD layer');
    for (const entry of entries) {
      if (entry.name === root || entry.name.endsWith('/')) continue;
      const resource = path.join(staging, entry.name);
      fs.mkdirSync(path.dirname(resource), { recursive: true });
      fs.writeFileSync(resource, entry.data);
      fs.utimesSync(resource, ZIP_TIMESTAMP, ZIP_TIMESTAMP);
    }
    const stem = root.slice(0, -path.posix.extname(root).length);
    const text = path.join(staging, `${stem}.usda`),
      binary = path.join(staging, `${stem}.usdc`);
    fs.mkdirSync(path.dirname(text), { recursive: true });
    fs.writeFileSync(text, baked.layer);
    run('usdcat', [text, '-o', binary]);
    fs.utimesSync(binary, ZIP_TIMESTAMP, ZIP_TIMESTAMP);
    const prepared = path.join(staging, 'prepared.usdz');
    run('usdzip', [prepared, '--arkitAsset', binary], {
      cwd: staging,
      env: { ...process.env, TZ: 'UTC' },
    });
    run('usdcat', [prepared, '--loadOnly']);
    fs.copyFileSync(prepared, output);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const metadata = {
    sourceSha256: sha256(source),
    preparedSha256: sha256(output),
    sourceByteLength: fs.statSync(source).size,
    preparedByteLength: fs.statSync(output).size,
    sampleTime: time,
    bakedAttributeCount: baked.count,
    partCount: order.length,
    assemblyOrder: order,
    ...layerMetadata(original),
  };
  fs.mkdirSync(path.dirname(metadataOutput), { recursive: true });
  fs.writeFileSync(metadataOutput, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}
if (require.main === module) {
  try {
    const { values } = require('node:util').parseArgs({
      options: {
        source: { type: 'string' },
        output: { type: 'string' },
        'metadata-output': { type: 'string' },
        'sample-time': { type: 'string', default: String(ASSEMBLED_TIME_CODE) },
      },
    });
    if (!values.source || !values.output || !values['metadata-output'])
      throw new Error('Required: --source --output --metadata-output');
    const result = prepare(
      values.source,
      values.output,
      values['metadata-output'],
      Number(values['sample-time']),
    );
    console.log(
      `Prepared ${result.partCount} parts at time ${result.sampleTime}: ${values.output}`,
    );
  } catch (error) {
    console.error(`AR assembly preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = {
  prepare,
  assemblyOrder,
  bakeLayer,
  layerMetadata,
  archiveResources,
};
