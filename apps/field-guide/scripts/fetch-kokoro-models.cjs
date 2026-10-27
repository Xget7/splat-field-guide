#!/usr/bin/env node
// Fetch pinned build resources; the app never downloads speech resources at runtime.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: pause } = require('node:timers/promises');
const REPO = path.resolve(__dirname, '../../..');
const PACKAGE = path.join(REPO, 'packages/react-native-on-device');
const DESTINATION = path.join(PACKAGE, 'ios/KokoroResources');
const MANIFEST = path.join(__dirname, 'kokoro-models.json');
const RETRIES = 3;
const CONCURRENCY = 4;
async function digest(file) {
  const checksum = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) checksum.update(chunk);
  return checksum.digest('hex');
}
async function acquireLock(file) {
  for (;;) {
    try {
      const handle = await fsp.open(file, 'wx');
      await handle.writeFile(String(process.pid));
      return async () => {
        await handle.close();
        await fsp.rm(file, { force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = Number(await fsp.readFile(file, 'utf8'));
        if (Number.isSafeInteger(owner) && owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (probe) {
            if (probe.code !== 'ESRCH') throw probe;
            await fsp.rm(file, { force: true });
            continue;
          }
        } else if (Date.now() - (await fsp.stat(file)).mtimeMs > 120000) {
          await fsp.rm(file, { force: true });
          continue;
        }
      } catch (probe) {
        if (probe.code !== 'ENOENT') throw probe;
      }
      await pause(100);
    }
  }
}
async function fetchAsset(
  asset,
  { destination, verifyOnly, fetchImpl, retryPause },
) {
  const target = path.resolve(destination, asset.path);
  if (!target.startsWith(`${path.resolve(destination)}${path.sep}`))
    throw new Error('Unsafe Kokoro resource path');
  try {
    if ((await digest(target)) === asset.sha256) return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (verifyOnly)
    throw new Error(`Missing or damaged Kokoro resource: ${target}`);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const response = await fetchImpl(asset.url, {
        headers: { 'User-Agent': 'FieldGuide-build/1' },
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok || !response.body)
        throw new Error(`Kokoro download failed: HTTP ${response.status}`);
      await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(temporary, { flags: 'wx' }),
      );
      if ((await digest(temporary)) !== asset.sha256)
        throw new Error(`SHA-256 mismatch for ${asset.path}`);
      await fsp.rename(temporary, target);
      console.log(`Verified ${asset.path}`);
      return;
    } catch (error) {
      await fsp.rm(temporary, { force: true });
      if (attempt === RETRIES - 1) throw error;
      await retryPause((attempt + 1) * 1000);
    }
  }
}
async function fetchModels({
  destination = DESTINATION,
  manifest = MANIFEST,
  licenseDirectory = path.join(PACKAGE, 'LICENSES'),
  verifyOnly = false,
  fetchImpl = globalThis.fetch,
  retryPause = pause,
} = {}) {
  await fsp.mkdir(destination, { recursive: true });
  const release = await acquireLock(
    path.join(path.dirname(destination), '.kokoro-fetch-node.lock'),
  );
  try {
    const assets = JSON.parse(await fsp.readFile(manifest, 'utf8'));
    let next = 0;
    // Workers settle before unlocking, including when one download fails.
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, assets.length) },
      async () => {
        while (next < assets.length)
          await fetchAsset(assets[next++], {
            destination,
            verifyOnly,
            fetchImpl,
            retryPause,
          });
      },
    );
    const results = await Promise.allSettled(workers);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    for (const name of await fsp.readdir(licenseDirectory)) {
      if (name.endsWith('.txt'))
        await fsp.copyFile(
          path.join(licenseDirectory, name),
          path.join(destination, name),
        );
    }
    const sizes = await Promise.all(
      assets.map(
        async asset =>
          (
            await fsp.stat(path.join(destination, asset.path))
          ).size,
      ),
    );
    const size = sizes.reduce((sum, bytes) => sum + bytes, 0);
    console.log(
      `Kokoro bundle verified: ${size.toLocaleString(
        'en-US',
      )} bytes, no runtime downloads`,
    );
    return size;
  } finally {
    await release();
  }
}
if (require.main === module) {
  try {
    const { values } = require('node:util').parseArgs({
      options: { 'verify-only': { type: 'boolean', default: false } },
    });
    fetchModels({ verifyOnly: values['verify-only'] }).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { fetchModels };
