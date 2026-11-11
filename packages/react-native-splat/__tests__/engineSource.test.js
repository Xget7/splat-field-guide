const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scripts = path.resolve(__dirname, '../scripts');

test('source import pins committed bytes and detects downstream divergence', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'splat-source-'));
  try {
    const repo = path.join(fixture, 'upstream');
    const pkg = path.join(fixture, 'consumer');
    fs.mkdirSync(repo);
    fs.mkdirSync(pkg);
    fs.cpSync(scripts, path.join(pkg, 'scripts'), { recursive: true });
    const git = (...args) => execFileSync('git', ['-C', repo, ...args]).toString().trim();
    git('init', '--quiet');
    for (const name of ['splat-core', 'splatkit-engine', 'splatkit-ios', 'splatkit-android']) {
      const dir = path.join(repo, 'packages', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'source.cpp'), `// ${name}\n`);
    }
    for (const name of ['LICENSE', '.clang-format', '.clang-tidy']) {
      fs.writeFileSync(path.join(repo, name), name);
    }
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Add fixture');
    const revision = git('rev-parse', 'HEAD');
    const upstream = path.join(repo, 'packages/splat-core/source.cpp');
    fs.writeFileSync(upstream, '// uncommitted\n');
    const artifact = (...args) => execFileSync('ruby', [path.join(pkg, 'scripts/engine-artifact.rb'), ...args], { stdio: 'pipe' }).toString().trim();
    assert.equal(artifact('--import-source', repo, revision), revision);
    assert.equal(artifact('--verify-source'), revision);
    const imported = path.join(pkg, 'engine/splat-core/source.cpp');
    assert.equal(fs.readFileSync(imported, 'utf8'), '// splat-core\n');
    assert.equal(fs.readFileSync(upstream, 'utf8'), '// uncommitted\n');
    fs.appendFileSync(imported, '// patch\n');
    assert.throws(() => artifact('--verify-source'), /differ from the receipt/);
    artifact('--import-source', repo, revision);
    const extra = path.join(pkg, 'engine/extra.cpp');
    fs.writeFileSync(extra, '// extra');
    assert.throws(() => artifact('--verify-source'), /differ from the receipt/);
    fs.unlinkSync(extra);
    fs.unlinkSync(imported);
    assert.throws(() => artifact('--verify-source'), /differ from the receipt/);
    artifact('--import-source', repo, revision);
    fs.chmodSync(imported, 0o755);
    assert.throws(() => artifact('--verify-source'), /differ from the receipt/);
    artifact('--import-source', repo, revision);
    assert.throws(() => artifact('--import-source', repo, 'HEAD'), /full SplatKit commit SHA/);
    assert.equal(artifact('--verify-source'), revision);
    fs.unlinkSync(upstream);
    fs.symlinkSync('../splatkit-engine/source.cpp', upstream);
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Add symlink');
    assert.throws(() => artifact('--import-source', repo, git('rev-parse', 'HEAD')), /Unsupported upstream entry/);
    assert.equal(artifact('--verify-source'), revision);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
