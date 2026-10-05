const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('preparation reuses only a current artifact and force rebuilds it', () => {
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, 'build/artifact-'));
  try {
    const scripts = path.join(fixture, 'scripts');
    const bin = path.join(fixture, 'bin');
    fs.mkdirSync(scripts);
    fs.mkdirSync(bin);
    for (const name of fs.readdirSync(path.join(root, 'scripts'))) {
      fs.copyFileSync(
        path.join(root, 'scripts', name),
        path.join(scripts, name),
      );
    }
    fs.mkdirSync(path.join(fixture, 'engine'));
    const source = path.join(fixture, 'engine/source.cpp');
    fs.writeFileSync(source, 'int version = 1;\n');
    for (const name of ['cmake', 'xcrun']) {
      const file = path.join(bin, name);
      fs.writeFileSync(
        file,
        `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const tool = path.basename(process.argv[1]);
if (tool === 'xcrun' && args.includes('--show-sdk-path')) console.log('/sdk');
if (tool === 'xcrun' && args[0] === 'libtool') {
  const output = args[args.indexOf('-o') + 1];
  fs.writeFileSync(output, 'library');
  if (output.includes('iphonesimulator')) fs.appendFileSync(process.env.CALLS, 'build\\n');
}
`,
      );
      fs.chmodSync(file, 0o755);
    }
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CALLS: path.join(fixture, 'calls'),
      SPLAT_BUILD_JOBS: '1',
    };
    // The builder copies these headers after the fake compilation.
    for (const relative of [
      'splatkit-ios/module.modulemap',
      'splatkit-engine/include/splatkit/sfg.h',
      'splatkit-ios/Sources/SplatKitCore/include/splatkit/sfg_metal.h',
    ]) {
      const file = path.join(fixture, 'engine', relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'header');
    }
    const build = (...args) =>
      execFileSync(
        'bash',
        [path.join(scripts, 'build-ios-engine.sh'), ...args],
        { env },
      );
    const count = () =>
      fs.readFileSync(env.CALLS, 'utf8').trim().split('\n').length;
    build();
    build();
    assert.equal(count(), 1, 'a current framework must not be rebuilt');
    build('--force');
    assert.equal(count(), 2);
    fs.writeFileSync(source, 'int version = 2;\n');
    assert.throws(
      () =>
        execFileSync(
          'ruby',
          [path.join(scripts, 'engine-artifact.rb'), '--verify'],
          { env, stdio: 'pipe' },
        ),
      /scripts\/prepare.sh/,
    );
    build();
    assert.equal(count(), 3);
    execFileSync(
      'ruby',
      [path.join(scripts, 'engine-artifact.rb'), '--verify'],
      { env },
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
