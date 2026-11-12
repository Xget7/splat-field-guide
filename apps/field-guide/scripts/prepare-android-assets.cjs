const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const PACK_ROOT = path.join(ROOT, 'data/pack');
const FONT_ROOT = path.resolve(__dirname, '../assets/fonts');
const NOTICE_SEPARATOR =
  '========================================================================';
const IOS_ONLY_NOTICES = new Set(['SocketRocket']);

function prepareAssets(destination, packRoot = PACK_ROOT, packs = []) {
  fs.rmSync(destination, { recursive: true, force: true });
  // Only packs the build names ship; none by default.
  require('../../../scripts/copy_bundled_packs.cjs').copyPacks(
    packRoot,
    path.join(destination, 'packs'),
    packs,
  );
  require('../../../scripts/copy_course_documents.cjs').copyDocuments(
    JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../assets/documents/catalog.json'),
        'utf8',
      ),
    ),
    process.env.FIELD_GUIDE_DOCUMENTS_DIR || '',
    path.join(destination, 'documents'),
    packs,
  );
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
  const vulkanLicense = path.join(
    ROOT,
    'packages/react-native-splat/engine/splatkit-android/src/main/resources/META-INF/LICENSE-splatkit-android.txt',
  );
  fs.copyFileSync(vulkanLicense, path.join(licenses, 'SplatKit-Android.txt'));
  const hashLicense = path.join(
    ROOT,
    'packages/react-native-splat/engine/splat-core/third_party/picosha2/LICENSE',
  );
  fs.copyFileSync(hashLicense, path.join(licenses, 'PicoSHA2.txt'));
  // Shared license texts have one maintained copy, with platform-only sections excluded.
  const sharedNotices = fs
    .readFileSync(
      path.resolve(__dirname, '../ios/FieldGuide/ThirdPartyNotices.txt'),
      'utf8',
    )
    .split(new RegExp(`^${NOTICE_SEPARATOR}$`, 'm'))
    .filter(
      (section, index) =>
        index === 0 ||
        !IOS_ONLY_NOTICES.has(section.trimStart().split('\n')[0]),
    )
    .join(NOTICE_SEPARATOR);
  const androidNotices = fs.readFileSync(
    path.resolve(__dirname, '../android/ThirdPartyNotices.txt'),
    'utf8',
  );
  const nativeNotices = [
    [
      vulkanLicense,
      'SplatKit Android, Vulkan Memory Allocator and third parties',
    ],
    [hashLicense, 'PicoSHA2'],
  ]
    .map(
      ([file, title]) =>
        `${NOTICE_SEPARATOR}\n${title}\n\n${fs.readFileSync(file, 'utf8')}`,
    )
    .join('\n');
  fs.writeFileSync(
    path.join(destination, 'ThirdPartyNotices.txt'),
    [sharedNotices, androidNotices, nativeNotices].join('\n'),
  );
}

module.exports = { prepareAssets };
// The build selects packs explicitly, as `<packId>/<packVersion>` entries separated by spaces.
const selectedPacks = () =>
  (process.env.FIELD_GUIDE_PACKS ?? '').split(/\s+/).filter(Boolean);

if (require.main === module)
  prepareAssets(path.resolve(process.argv[2]), PACK_ROOT, selectedPacks());
