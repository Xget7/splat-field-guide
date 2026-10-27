#!/usr/bin/env node
// Bundle only the pinned prepared bytes; missing local resources remain unavailable.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function copyAssembly(env = process.env) {
  const root = path.resolve(fs.realpathSync(env.SRCROOT), '../../..');
  const metadata = JSON.parse(
    fs.readFileSync(
      path.join(root, 'apps/field-guide/assets/ar/v8-engine.json'),
      'utf8',
    ),
  );
  const source = path.join(root, metadata.preparedPath);
  const destination = path.join(
    env.TARGET_BUILD_DIR,
    env.UNLOCALIZED_RESOURCES_FOLDER_PATH,
    metadata.modelPath,
  );
  if (!fs.existsSync(source)) {
    fs.rmSync(destination, { force: true });
    console.log(
      'note: V8 capture is missing; prepare it with scripts/prepare_ar_assembly.cjs',
    );
    return;
  }
  const bytes = fs.readFileSync(source);
  if (
    bytes.length !== metadata.preparedByteLength ||
    crypto.createHash('sha256').update(bytes).digest('hex') !==
      metadata.preparedSha256
  )
    throw new Error(
      'Prepared V8 capture does not match assets/ar/v8-engine.json',
    );
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  console.log(
    `Bundled V8 capture: ${metadata.partCount} parts, SHA-256 verified`,
  );
}
if (require.main === module) {
  try {
    copyAssembly();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { copyAssembly };
