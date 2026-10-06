const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../../..');
const PACK_ROOT = path.join(ROOT, 'data/pack');
const FONT_ROOT = path.resolve(__dirname, '../assets/fonts');
const LABEL_HEADER_BYTES = 16;

function prepareAssets(destination, packRoot = PACK_ROOT) {
  fs.rmSync(destination, { recursive: true, force: true });
  for (const guide of fs.readdirSync(packRoot, { withFileTypes: true })) {
    if (!guide.isDirectory() || guide.name.startsWith('.')) continue;
    for (const version of fs.readdirSync(path.join(packRoot, guide.name), {
      withFileTypes: true,
    })) {
      if (!version.isDirectory()) continue;
      const source = path.join(packRoot, guide.name, version.name);
      const manifestPath = path.join(source, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (
        manifest.packId !== guide.name ||
        String(manifest.packVersion) !== version.name
      ) {
        throw new Error(
          `Pack identity does not match its directory: ${source}`,
        );
      }
      const target = path.join(destination, 'packs', guide.name, version.name);
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(manifestPath, path.join(target, 'manifest.json'));
      for (const tier of manifest.tiers) {
        if (tier.labels.bytes !== tier.splatCount + LABEL_HEADER_BYTES)
          throw new Error(`Pack count mismatch: ${source}`);
        for (const record of [tier.cloud, tier.labels]) {
          const file = path.resolve(source, record.path);
          if (!file.startsWith(source + path.sep))
            throw new Error('Pack path escapes its directory');
          const bytes = fs.readFileSync(file);
          const digest = crypto
            .createHash('sha256')
            .update(bytes)
            .digest('hex');
          if (bytes.length !== record.bytes || digest !== record.sha256) {
            throw new Error(`Pack digest mismatch: ${file}`);
          }
          const output = path.join(target, record.path);
          fs.mkdirSync(path.dirname(output), { recursive: true });
          fs.copyFileSync(file, output);
        }
      }
    }
  }
  const fonts = path.join(destination, 'fonts');
  fs.mkdirSync(fonts, { recursive: true });
  for (const file of fs.readdirSync(FONT_ROOT))
    fs.copyFileSync(path.join(FONT_ROOT, file), path.join(fonts, file));
  const licenses = path.join(destination, 'licenses');
  fs.mkdirSync(licenses, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'packages/react-native-splat/engine/LICENSE'),
    path.join(licenses, 'SplatKit.txt'),
  );
  const vulkanLicenses = path.join(
    ROOT,
    'packages/react-native-splat/engine/splatkit-android/licenses',
  );
  for (const file of fs.readdirSync(vulkanLicenses))
    fs.copyFileSync(path.join(vulkanLicenses, file), path.join(licenses, file));
}

module.exports = { prepareAssets };
if (require.main === module) prepareAssets(path.resolve(process.argv[2]));
