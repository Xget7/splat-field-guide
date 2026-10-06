import {
  karaokeSpans,
  Meter,
  meterHeightsFor,
  normalizedLevel,
  SpanKind,
  speechTextFor,
  wordLevelFor,
} from './speechPresentation';

test('list items speak as sentences and karaoke ranges span their visible words', () => {
  const reply = '1. **Check:** Read the label\n2. Keep sparks away.';
  const speech = speechTextFor(reply);
  expect(speech).toBe('Check: Read the label. Keep sparks away.');
  const word = { location: speech.indexOf('sparks'), length: 'sparks'.length };
  expect(
    karaokeSpans('Check: Read the label', word, true, 0, speech.length),
  ).toEqual([{ text: 'Check: Read the label', kind: SpanKind.spoken }]);
  expect(
    karaokeSpans(
      'Keep sparks away.',
      word,
      true,
      speech.indexOf('Keep'),
      speech.length,
    ),
  ).toEqual([
    { text: 'Keep ', kind: SpanKind.spoken },
    { text: 'sparks', kind: SpanKind.current },
    { text: ' away.', kind: SpanKind.remaining },
  ]);
});

describe('karaoke spans', () => {
  test('idle and stopped speech show the entire text as spoken', () => {
    expect(
      karaokeSpans('Keep the cap closed.', { location: 9, length: 3 }, false),
    ).toEqual([{ text: 'Keep the cap closed.', kind: SpanKind.spoken }]);
  });

  test('before the first word the text is remaining', () => {
    expect(karaokeSpans('Keep the cap closed.', null, true)).toEqual([
      { text: 'Keep the cap closed.', kind: SpanKind.remaining },
    ]);
  });

  test('splits spoken, current and remaining text without losing whitespace', () => {
    expect(
      karaokeSpans('Keep the cap closed.', { location: 9, length: 3 }, true),
    ).toEqual([
      { text: 'Keep the ', kind: SpanKind.spoken },
      { text: 'cap', kind: SpanKind.current },
      { text: ' closed.', kind: SpanKind.remaining },
    ]);
  });

  test('UTF-16 ranges preserve emoji and punctuation', () => {
    const text = 'A 🔧 valve, cold.';
    const spans = karaokeSpans(text, { location: 5, length: 5 }, true);
    expect(spans).toEqual([
      { text: 'A 🔧 ', kind: SpanKind.spoken },
      { text: 'valve', kind: SpanKind.current },
      { text: ', cold.', kind: SpanKind.remaining },
    ]);
    expect(spans.map(span => span.text).join('')).toBe(text);
  });

  test('clips an oversized last word and omits empty spans', () => {
    expect(karaokeSpans('Engine', { location: 0, length: 99 }, true)).toEqual([
      { text: 'Engine', kind: SpanKind.current },
    ]);
    expect(karaokeSpans('', { location: 0, length: 1 }, true)).toEqual([]);
  });

  test.each([
    { location: -1, length: 2 },
    { location: 20, length: 2 },
    { location: 0, length: 0 },
    { location: 0, length: -1 },
    { location: 0.5, length: 2 },
    { location: NaN, length: 2 },
    { location: 0, length: Infinity },
  ])('invalid ranges leave readable text: %o', word => {
    expect(karaokeSpans('Engine', word, true)).toEqual([
      { text: 'Engine', kind: SpanKind.remaining },
    ]);
  });
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
