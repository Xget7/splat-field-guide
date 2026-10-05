import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseProgress, type Progress } from '../model/progress';

const PROGRESS_KEY = 'field-guide/progress/v1';
let pendingWrite = Promise.resolve();

// Completion must stay cleared even when an earlier save is still in flight.
function writeInOrder(write: () => Promise<void>): Promise<void> {
  const result = pendingWrite.then(write);
  pendingWrite = result.catch(() => {});
  return result;
}

export async function loadProgress(): Promise<Progress | null> {
  await pendingWrite;
  return parseProgress(await AsyncStorage.getItem(PROGRESS_KEY));
}

export async function saveProgress(progress: Progress): Promise<void> {
  await writeInOrder(() =>
    AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)),
  );
}

/** A finished or stopped procedure leaves nothing to continue. */
export async function clearProgress(): Promise<void> {
  await writeInOrder(() => AsyncStorage.removeItem(PROGRESS_KEY));
}
