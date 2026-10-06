import { parseProgress } from './progress';

const good = {
  guideId: 'gol-trend-engine-bay',
  procedureId: 'check-coolant',
  stepIndex: 1,
} as const;

test.each([
  null,
  '',
  '{bad',
  'null',
  '[]',
  'true',
  '42',
  '"text"',
  '{}',
  JSON.stringify({ ...good, guideId: 12 }),
  JSON.stringify({ ...good, procedureId: null }),
  JSON.stringify({ ...good, stepIndex: '1' }),
  JSON.stringify({ ...good, stepIndex: -1 }),
  JSON.stringify({ ...good, stepIndex: 1.5 }),
  JSON.stringify({ guideId: good.guideId, procedureId: good.procedureId }),
])('invalid progress reads as empty: %s', raw => {
  expect(parseProgress(raw)).toBeNull();
});

test('valid zero-based progress parses', () => {
  expect(parseProgress(JSON.stringify(good))).toEqual(good);
  expect(parseProgress(JSON.stringify({ ...good, stepIndex: 0 }))).toEqual({
    ...good,
    stepIndex: 0,
  });
});
