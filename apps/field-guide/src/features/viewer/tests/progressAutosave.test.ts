import { fakeInstructor } from '@tests/voiceSession';
import { LearnMode, type Progress } from '../../guide';
import { bundledPack } from '../../pack/bundledPack';
import { catalogFor, findReadyGuide } from '../../pack/catalog';
import {
  attachProgressAutosave,
  type ProgressWriter,
} from '../data/progressAutosave';
import { createViewerStore } from '../state/viewerStore';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
const guide = findReadyGuide(catalogFor(pack), pack.packId)!;
const COOLANT = 'check-coolant';
const CLEARED = 'cleared';

function recordingWriter() {
  const writes: (Progress | typeof CLEARED)[] = [];
  const writer: ProgressWriter = {
    save: async progress => {
      writes.push(progress);
    },
    clear: async () => {
      writes.push(CLEARED);
    },
  };
  return { writer, writes };
}

function openAt(stepIndex: number) {
  const store = createViewerStore();
  store.getState().open({
    guide,
    procedureId: COOLANT,
    stepIndex,
    mode: LearnMode.selfGuided,
    instructor: fakeInstructor(),
  });
  return store;
}

describe('progress autosave', () => {
  test('writes the continuation on attach and each time it changes', () => {
    const store = openAt(1);
    const { writer, writes } = recordingWriter();
    attachProgressAutosave(store, writer);
    expect(writes).toEqual([
      { guideId: guide.id, procedureId: COOLANT, stepIndex: 1 },
    ]);
    store.getState().next();
    store.getState().toggleLabels();
    store.getState().select('battery');
    store.getState().goTo(0);
    expect(writes).toEqual([
      { guideId: guide.id, procedureId: COOLANT, stepIndex: 1 },
      { guideId: guide.id, procedureId: COOLANT, stepIndex: 2 },
      CLEARED,
    ]);
  });

  test('exploring keeps the saved step, and nothing is written once detached', () => {
    const store = openAt(2);
    const { writer, writes } = recordingWriter();
    const detach = attachProgressAutosave(store, writer);
    store.getState().explore();
    expect(writes).toHaveLength(1);
    detach();
    store.getState().resumeGuide();
    store.getState().back();
    expect(writes).toHaveLength(1);
  });
});
