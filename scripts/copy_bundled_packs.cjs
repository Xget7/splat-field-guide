// Copy only explicitly bundled runtime files; preserve unchanged files across builds.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const MANIFEST = 'manifest.json';

function relativePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('/') ||
    /[\\\n\r\0*?[\]]/.test(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..')
  )
    throw new Error(`invalid bundled pack path: ${JSON.stringify(value)}`);
  return value;
}

function copyPacks(source, destination, packs) {
  const included = new Set();
  for (const name of packs) {
    const base = relativePath(name);
    const directory = path.resolve(source, base);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, MANIFEST), 'utf8'),
    );
    if (base !== `${manifest.packId}/${manifest.packVersion}`)
      throw new Error(`pack identity differs from its directory: ${name}`);
    const files = [
      MANIFEST,
      ...manifest.tiers.flatMap(tier =>
        ['world', 'labels'].map(kind => tier[kind].path),
      ),
    ];
    for (const file of files) {
      relativePath(file);
      const target = path.join(directory, file);
      const resolved = fs.realpathSync(target);
      const relative = path.relative(fs.realpathSync(directory), resolved);
      if (
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative) ||
        !fs.statSync(target).isFile() ||
        fs.lstatSync(target).isSymbolicLink()
      ) {
        throw new Error(`missing or linked runtime pack file: ${target}`);
      }
      const runtimePath = base + '/' + file;
      included.add('/' + runtimePath);
      for (
        let parent = path.posix.dirname(runtimePath);
        parent !== '.';
        parent = path.posix.dirname(parent)
      ) {
        if (fs.lstatSync(path.join(source, parent)).isSymbolicLink()) {
          throw new Error(`linked runtime pack directory: ${parent}`);
        }
        included.add('/' + parent + '/');
      }
    }
  }
  fs.mkdirSync(destination, { recursive: true });
  const result = spawnSync(
    'rsync',
    [
      '-a',
      '--delete',
      '--delete-excluded',
      '--prune-empty-dirs',
      '--include-from=-',
      '--exclude=*',
      path.resolve(source) + '/',
      path.resolve(destination) + '/',
    ],
    { input: [...included].sort().join('\n') + '\n', encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || `rsync failed: ${result.status}`);
}

module.exports = { copyPacks };
if (require.main === module) {
  const [source, destination, ...packs] = process.argv.slice(2);
  try {
    if (!source || !destination || !packs.length)
      throw new Error(
        'Usage: copy_bundled_packs.cjs <source> <destination> <pack/version>...',
      );
    copyPacks(source, destination, packs);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
