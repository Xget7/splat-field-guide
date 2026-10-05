import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseProgress } from '../../../../apps/field-guide/src/modules/progress/model/progress';
import {
  clearProgress,
  loadProgress,
  saveProgress,
} from '../../../../apps/field-guide/src/modules/progress/data/progressStorage';

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

test('progress survives a storage round trip', async () => {
  await AsyncStorage.clear();
  expect(await loadProgress()).toBeNull();
  await saveProgress(good);
  expect(await loadProgress()).toEqual(good);
});

test('a delayed save cannot resurrect progress after Stop clears it', async () => {
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  let release!: () => void;
  const delayed = new Promise<void>(resolve => {
    release = resolve;
  });
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (...args) => {
    await delayed;
    return write(...args);
  });
  const saving = saveProgress({
    guideId: 'gol-trend-engine-bay',
    procedureId: 'check-coolant',
    stepIndex: 2,
  });
  await Promise.resolve();
  const clearing = clearProgress();
  release();
  await Promise.all([saving, clearing]);
  expect(await loadProgress()).toBeNull();
});
