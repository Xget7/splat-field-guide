import type { Progress } from '../../guide';
import { progressTargetFor } from '../domain/viewerState';
import type { ViewerStore } from '../state/viewerStore';

const PROGRESS_FAILURE = 'Field guide: progress not saved';

/** The saved-progress adapter; it keeps its own writes in order. */
export interface ProgressWriter {
  save(progress: Progress): Promise<void>;
  clear(): Promise<void>;
}

const sameTarget = (a: Progress | null, b: Progress | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.guideId === b.guideId &&
    a.procedureId === b.procedureId &&
    a.stepIndex === b.stepIndex);

/**
 * Saves the open viewer's continuation now and whenever it changes, so leaving at any
 * moment keeps the latest position. Returns the detach.
 */
export function attachProgressAutosave(
  store: ViewerStore,
  progress: ProgressWriter,
): () => void {
  let written: Progress | null | undefined;
  function write() {
    const { viewer, guide } = store.getState();
    if (viewer === null || guide === null) {
      return;
    }
    const target = progressTargetFor(viewer, guide.id);
    if (written !== undefined && sameTarget(written, target)) {
      return;
    }
    written = target;
    const saved = target === null ? progress.clear() : progress.save(target);
    saved.catch(failure => console.warn(PROGRESS_FAILURE, failure));
  }
  write();
  return store.subscribe(write);
}
