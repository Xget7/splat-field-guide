const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const nativeSuite = process.platform === 'darwin' ? describe : describe.skip;

nativeSuite('native audio link PCM', () => {
  let directory;
  let output;
  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'AudioLinkPCM-'));
    output = path.join(directory, 'AudioLinkPCMProbe');
    execFileSync('nice', [
      '-n',
      '19',
      'swiftc',
      path.join(root, 'ios/AudioLinkPCM.swift'),
      path.join(__dirname, 'AudioLinkPCMProbe.swift'),
      '-module-cache-path',
      directory,
      '-o',
      output,
    ]);
  }, 30000);
  afterAll(() => {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  const probe = scenario =>
    JSON.parse(execFileSync(output, [scenario], { encoding: 'utf8' }));

  test('round-trips little-endian Int16 samples through floats within one step', () => {
    const { original, restored } = probe('roundTrip');
    expect(restored).toHaveLength(original.length);
    restored.forEach((sample, index) => {
      expect(Math.abs(sample - original[index])).toBeLessThanOrEqual(1);
    });
  });

  test('emits two 100 ms chunks and retains 50 ms until more input arrives', () => {
    expect(probe('chunks')).toEqual({
      first: [3200, 3200],
      second: [3200],
      remaining: 0,
      samples: Array.from({ length: 4800 }, (_, index) => index),
    });
  });

  test('counts only played speech across queue gaps and resets on clear', () => {
    expect(probe('playback')).toEqual({
      partial: 3600,
      finished: 4800,
      resumed: 6000,
      cleared: 0,
    });
  });

  test('rejects odd byte counts', () => {
    expect(probe('odd')).toEqual({ rejected: true });
  });
});
