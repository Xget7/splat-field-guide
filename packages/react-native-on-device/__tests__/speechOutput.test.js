const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const nativeSuite = process.platform === 'darwin' ? describe : describe.skip;

nativeSuite('native speech voice preparation', () => {
  let directory;
  let output;
  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'SpeechOutput-'));
    output = path.join(directory, 'SpeechOutputProbe');
    const library = path.join(directory, 'libNitroModules.a');
    const target = `${
      process.arch === 'arm64' ? 'arm64' : 'x86_64'
    }-apple-macos26.0`;
    const compile = args =>
      execFileSync('nice', [
        '-n',
        '19',
        'swiftc',
        ...args,
        '-target',
        target,
        '-module-cache-path',
        directory,
      ]);
    compile([
      path.join(__dirname, 'NitroModulesStub.swift'),
      '-emit-library',
      '-static',
      '-emit-module',
      '-module-name',
      'NitroModules',
      '-emit-module-path',
      path.join(directory, 'NitroModules.swiftmodule'),
      '-o',
      library,
    ]);
    compile([
      path.join(root, 'ios/HybridSpeechOutput.swift'),
      path.join(root, 'ios/SpeechTextPlan.swift'),
      path.join(__dirname, 'SpeechOutputProbe.swift'),
      '-I',
      directory,
      library,
      '-o',
      output,
    ]);
  }, 30000);
  afterAll(() => {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });
  const prepare = voice =>
    JSON.parse(execFileSync(output, [voice], { encoding: 'utf8' }));

  test('prepares the system voice without loading the offline model', () => {
    expect(prepare('system')).toEqual({ voice: 'system', loaded: false });
  });
  test('prepares Kokoro on demand and returns the system voice when it cannot load', () => {
    expect(prepare('kokoro')).toEqual({ voice: 'kokoro', loaded: true });
    expect(prepare('failure')).toEqual({ voice: 'system', loaded: true });
  });
});
