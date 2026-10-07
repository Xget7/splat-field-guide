const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const resources = path.resolve(__dirname, '../../../data/ar-assembly/v8-engine');
const capture = path.join(resources, 'engine.usdz');
const preparation = path.join(resources, 'preparation.json');
const batchMetadata = path.resolve(__dirname, '../../../apps/field-guide/assets/ar/v8-engine.json');

test(
  'prepared V8 preserves parts and textures with sequential playback and next-part visibility',
  {
    skip:
      process.platform !== 'darwin'
        ? 'RealityKit requires macOS'
        : !fs.existsSync(capture) || !fs.existsSync(preparation)
          ? 'Prepare the actual V8 resources before checking native assembly'
          : false,
  },
  () => {
    const build = path.resolve(__dirname, '../build');
    fs.mkdirSync(build, { recursive: true });
    const fixture = fs.mkdtempSync(path.join(build, 'ar-assembly-'));
    try {
      const executable = path.join(fixture, 'assembly');
      execFileSync('xcrun', [
        'swiftc',
        '-module-cache-path',
        path.join(fixture, 'modules'),
        path.resolve(__dirname, '../ios/ARPlacementAssembly.swift'),
        path.join(__dirname, 'ARPlacementAssemblyHarness.swift'),
        '-o',
        executable,
      ]);
      assert.match(
        execFileSync(executable, [capture, preparation, batchMetadata], { encoding: 'utf8' }),
        /AR placement assembly passed/,
      );
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  },
);
