import {
  Meter,
  meterHeightsFor,
  normalizedLevel,
  speechTextFor,
  wordLevelFor,
} from '../apps/field-guide/src/features/instructor/voice/speechPresentation';

test('list items speak as sentences without list markers', () => {
  expect(
    speechTextFor('1. **Check:** Read the label\n2. Keep sparks away.'),
  ).toBe('Check: Read the label. Keep sparks away.');
});

describe('level meter', () => {
  test('silence is five short bars; loud speech makes the middle bar tallest', () => {
    expect(meterHeightsFor(0)).toEqual([4, 4, 4, 4, 4]);
    expect(meterHeightsFor(1)).toEqual([8.5, 11.5, 14, 11.5, 8.5]);
    expect(meterHeightsFor(0.5)).toEqual([6.25, 7.75, 9, 7.75, 6.25]);
  });

  test.each([-10, 0, 0.5, 1, 10, NaN, Infinity])(
    'levels stay within the meter bounds: %s',
    level => {
      for (const height of meterHeightsFor(level)) {
        expect(height).toBeGreaterThanOrEqual(Meter.minHeight);
        expect(height).toBeLessThanOrEqual(Meter.maxHeight);
      }
    },
  );

  test('normalizes malformed or out-of-range levels', () => {
    expect(normalizedLevel(-1)).toBe(0);
    expect(normalizedLevel(2)).toBe(1);
    expect(normalizedLevel(NaN)).toBe(0);
    expect(normalizedLevel(Infinity)).toBe(0);
  });

  test('each word kicks an envelope scaled by length and capped at full level', () => {
    expect(wordLevelFor(1)).toBe(0.25);
    expect(wordLevelFor(5)).toBe(0.5);
    expect(wordLevelFor(10)).toBe(1);
    expect(wordLevelFor(100)).toBe(1);
  });

  test.each([0, -1, NaN, Infinity])(
    'invalid word lengths have no envelope: %s',
    length => {
      expect(wordLevelFor(length)).toBe(0);
    },
  );
});
