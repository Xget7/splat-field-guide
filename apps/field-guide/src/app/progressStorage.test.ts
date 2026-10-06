import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearProgress, loadProgress, saveProgress } from './progressStorage';

const good = {
  guideId: 'gol-trend-engine-bay',
  procedureId: 'check-coolant',
  stepIndex: 1,
} as const;

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
