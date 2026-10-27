import type { KeyValueStorage } from '../../../platform/ports';
import { parseProgress, type Progress } from '../domain/progress';

const PROGRESS_KEY = 'field-guide/progress/v1';

/** The saved progress: one record, read and replaced whole. */
export interface ProgressStorage {
  load(): Promise<Progress | null>;
  save(progress: Progress): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Keeps progress in the storage with its writes in call order, and a load waits for the
 * writes called before it, so completion stays cleared even when an earlier save is
 * still in flight.
 */
export function createProgressStorage(
  storage: KeyValueStorage,
): ProgressStorage {
  let pendingWrite = Promise.resolve();
  function writeInOrder(write: () => Promise<void>): Promise<void> {
    const result = pendingWrite.then(write);
    pendingWrite = result.catch(() => {});
    return result;
  }
  return {
    async load() {
      await pendingWrite;
      return parseProgress(await storage.getItem(PROGRESS_KEY));
    },
    save: progress =>
      writeInOrder(() =>
        storage.setItem(PROGRESS_KEY, JSON.stringify(progress)),
      ),
    clear: () => writeInOrder(() => storage.removeItem(PROGRESS_KEY)),
  };
}
