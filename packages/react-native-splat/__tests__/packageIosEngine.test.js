const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packageEngine } = require('../scripts/package-ios-engine.cjs');

test(
  'XCFramework exposes both iOS slices and the copied public headers',
  { skip: process.platform !== 'darwin' },
  () => {
    const fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), 'splat-xcframework-'),
    );
    try {
      for (const sdk of ['iphoneos', 'iphonesimulator']) {
        fs.mkdirSync(path.join(fixture, sdk));
        fs.writeFileSync(path.join(fixture, sdk, 'libSplatKitCore.a'), sdk);
      }
      fs.mkdirSync(path.join(fixture, 'headers/splatkit'), { recursive: true });
      fs.writeFileSync(
        path.join(fixture, 'headers/splatkit/sfg.h'),
        'public C interface',
      );
      const output = path.join(fixture, 'SplatKitCore.xcframework');
      packageEngine(fixture, output);
      const metadata = JSON.parse(
        execFileSync(
          'plutil',
          ['-convert', 'json', '-o', '-', path.join(output, 'Info.plist')],
          { encoding: 'utf8' },
        ),
      );
      assert.equal(metadata.CFBundlePackageType, 'XFWK');
      assert.equal(metadata.XCFrameworkFormatVersion, '1.0');
      assert.deepEqual(
        metadata.AvailableLibraries.map(entry => entry.LibraryIdentifier),
        ['ios-arm64', 'ios-arm64-simulator'],
      );
      for (const [index, entry] of metadata.AvailableLibraries.entries()) {
        assert.deepEqual(entry.SupportedArchitectures, ['arm64']);
        assert.equal(entry.SupportedPlatform, 'ios');
        assert.equal(
          entry.SupportedPlatformVariant,
          index ? 'simulator' : undefined,
        );
        const slice = path.join(output, entry.LibraryIdentifier);
        assert.equal(
          fs.readFileSync(path.join(slice, entry.LibraryPath), 'utf8'),
          index ? 'iphonesimulator' : 'iphoneos',
        );
        assert.equal(
          fs.readFileSync(
            path.join(slice, entry.HeadersPath, 'splatkit/sfg.h'),
            'utf8',
          ),
          'public C interface',
        );
      }
      assert.throws(() => packageEngine(fixture, output), /must not exist/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  },
);
