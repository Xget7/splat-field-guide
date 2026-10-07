const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INPUT_CHUNK_BYTES = 3200;
const TOTAL_INPUT_SAMPLES = 4800;
const PARTIAL_PLAYBACK_FRAMES = 3600;
const FINISHED_PLAYBACK_FRAMES = 4800;
const RESUMED_PLAYBACK_FRAMES = 6000;

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

  test('encodes and decodes literal little-endian bytes', () => {
    expect(probe('literal')).toEqual({
      decoded: 0x0102,
      encoded: [0x02, 0x01],
    });
  });

  test('clips samples beyond full scale to signed PCM16 limits', () => {
    expect(probe('clipping')).toEqual({ bytes: [0xff, 0x7f, 0x00, 0x80] });
  });

  test('round-trips little-endian Int16 samples through floats within one step', () => {
    const { original, restored } = probe('roundTrip');
    expect(restored).toHaveLength(original.length);
    restored.forEach((sample, index) => {
      expect(Math.abs(sample - original[index])).toBeLessThanOrEqual(1);
    });
  });

  test('emits two 100 ms chunks and retains 50 ms until more input arrives', () => {
    expect(probe('chunks')).toEqual({
      first: [INPUT_CHUNK_BYTES, INPUT_CHUNK_BYTES],
      second: [INPUT_CHUNK_BYTES],
      remaining: 0,
      samples: Array.from({ length: TOTAL_INPUT_SAMPLES }, (_, index) => index),
    });
  });

  test('counts only played speech across queue gaps and resets on clear', () => {
    expect(probe('playback')).toEqual({
      partial: PARTIAL_PLAYBACK_FRAMES,
      finished: FINISHED_PLAYBACK_FRAMES,
      resumed: RESUMED_PLAYBACK_FRAMES,
      cleared: 0,
    });
  });

  test('rejects odd byte counts', () => {
    expect(probe('odd')).toEqual({ rejected: true });
  });
});
