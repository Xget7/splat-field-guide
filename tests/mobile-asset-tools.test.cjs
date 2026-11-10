const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  fetchModels,
} = require('../apps/field-guide/scripts/fetch-kokoro-models.cjs');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fixture = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'field-guide-assets-'));
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
