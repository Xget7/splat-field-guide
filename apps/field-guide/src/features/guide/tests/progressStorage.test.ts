import { fakeStorage } from '@tests/platform';
import { createProgressStorage } from '../data/progressStorage';

const good = {
  guideId: 'gol-trend-engine-bay',
  procedureId: 'check-coolant',
  stepIndex: 1,
} as const;

test('progress survives a storage round trip', async () => {
  const progress = createProgressStorage(fakeStorage().storage);
  expect(await progress.load()).toBeNull();
  await progress.save(good);
  expect(await progress.load()).toEqual(good);
});

test('a delayed save cannot resurrect progress after Stop clears it', async () => {
  const device = fakeStorage();
  const progress = createProgressStorage(device.storage);
  const release = device.delayNextWrite();
  const saving = progress.save({ ...good, stepIndex: 2 });
  const clearing = progress.clear();
  // A load called after both writes waits for them, even while the save is held.
  const loading = progress.load();
  release();
  await Promise.all([saving, clearing]);
  expect(await loading).toBeNull();
  expect(device.items.size).toBe(0);
});

test('a failed write leaves later writes in order', async () => {
  const device = fakeStorage();
  const progress = createProgressStorage(device.storage);
  device.storage.setItem.mockRejectedValueOnce(new Error('full'));
  await expect(progress.save(good)).rejects.toThrow('full');
  await progress.save({ ...good, stepIndex: 3 });
  expect(await progress.load()).toEqual({ ...good, stepIndex: 3 });
});
