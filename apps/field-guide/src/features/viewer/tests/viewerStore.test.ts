import { fakeInstructor } from '@tests/voiceSession';
import { LearnMode, SessionEventType } from '../../guide';
import type { Instructor } from '../../instructor';
import { bundledPack } from '../../pack/bundledPack';
import { catalogFor, findReadyGuide } from '../../pack/catalog';
import { Capability } from '../domain/capability';
import { progressTargetFor } from '../domain/viewerState';
import { createViewerStore, type VoicePort } from '../state/viewerStore';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
const guide = findReadyGuide(catalogFor(pack), pack.packId)!;
const COOLANT = 'check-coolant';
const COOLANT_STEPS = pack.procedures.find(item => item.id === COOLANT)!.steps
  .length;

function openStore(
  stepIndex = 0,
  mode: LearnMode = LearnMode.selfGuided,
  instructor: Instructor = fakeInstructor(),
) {
  const store = createViewerStore();
  store
    .getState()
    .open({ guide, procedureId: COOLANT, stepIndex, mode, instructor });
  return store;
}

function recordingVoice(accepts = false): VoicePort & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    ask: jest.fn((question: string) => {
      asked.push(question);
      return accepts;
    }),
    interrupt: jest.fn(),
    stop: jest.fn(),
  };
}

describe('viewer store', () => {
  test('Next moves on until the last step, where it finishes the procedure and stops the voice', () => {
    const store = openStore(COOLANT_STEPS - 2);
    const voice = recordingVoice();
    store.getState().attachVoice(voice);
    expect(store.getState().next()).toBe(false);
    expect(store.getState().display?.session.stepIndex).toBe(COOLANT_STEPS - 1);
    expect(voice.stop).not.toHaveBeenCalled();
    expect(store.getState().next()).toBe(true);
    expect(voice.stop).toHaveBeenCalledTimes(1);
    expect(store.getState().display?.session.procedureId).toBeNull();
  });

  test('Guide resumes the explored procedure, or opens the picker when there is none to resume', () => {
    const store = openStore(2);
    store.getState().explore();
    expect(store.getState().display?.exploring).toBe(true);
    store.getState().resumeGuide();
    expect(store.getState().display?.session).toMatchObject({
      procedureId: COOLANT,
      stepIndex: 2,
    });
    expect(store.getState().pickerVisible).toBe(false);

    store.getState().dispatch({ type: SessionEventType.end });
    store.getState().resumeGuide();
    expect(store.getState().pickerVisible).toBe(true);
    expect(store.getState().display?.session.procedureId).toBeNull();
  });

  test('choosing the open capability toggles full view; choosing the other one shows its drawer', () => {
    const store = openStore(1);
    store.getState().chooseCapability(Capability.guide);
    expect(store.getState().fullView).toBe(true);
    store.getState().chooseCapability(Capability.explore);
    expect(store.getState().fullView).toBe(false);
    expect(store.getState().display?.exploring).toBe(true);
    store.getState().chooseCapability(Capability.explore);
    expect(store.getState().fullView).toBe(true);
    store.getState().chooseCapability(Capability.guide);
    expect(store.getState().fullView).toBe(false);
    expect(store.getState().display?.session.stepIndex).toBe(1);
  });

  test('a question goes to an active voice first, else asks about the session as it is now', () => {
    const instructor = fakeInstructor();
    const ask = jest.spyOn(instructor.turns, 'ask');
    const store = openStore(0, LearnMode.instructor, instructor);
    const voice = recordingVoice(true);
    store.getState().attachVoice(voice);
    store.getState().ask('  Why check it?  ');
    expect(voice.asked).toEqual(['Why check it?']);
    expect(ask).not.toHaveBeenCalled();

    store.getState().attachVoice(recordingVoice(false));
    store.getState().next();
    store.getState().ask('What now?');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatchObject({
      question: 'What now?',
      state: { procedureId: COOLANT, stepIndex: 1 },
    });
    store.getState().ask('   ');
    expect(ask).toHaveBeenCalledTimes(1);
  });

  test('closing the instructor stops its voice and the probes; opening it prewarms the answerers', () => {
    const instructor = fakeInstructor();
    const prewarm = jest.spyOn(instructor.turns, 'prewarm');
    const store = openStore(0, LearnMode.selfGuided, instructor);
    const voice = recordingVoice();
    store.getState().attachVoice(voice);
    expect(prewarm).not.toHaveBeenCalled();
    store.getState().toggleInstructor();
    expect(store.getState().instructorOpen).toBe(true);
    expect(instructor.setInstructorOpen).toHaveBeenLastCalledWith(true);
    expect(prewarm).toHaveBeenCalledWith(pack);
    store.getState().toggleInstructor();
    expect(voice.stop).toHaveBeenCalledTimes(2);
    expect(instructor.setInstructorOpen).toHaveBeenLastCalledWith(false);
    store.getState().setInstructorDockExpanded(true);
    expect(store.getState().instructorOpen).toBe(true);
  });

  test('layout changes keep the displayed values the same', () => {
    const store = openStore(1);
    const before = store.getState().display;
    store.getState().toggleLabels();
    store.getState().openPicker();
    store.getState().recenter();
    expect(store.getState().display).toBe(before);
  });
});

describe('progress target', () => {
  const open = (stepIndex: number) => openStore(stepIndex).getState().viewer!;

  test('a procedure past its first step is saved', () => {
    expect(progressTargetFor(open(2), guide.id)).toEqual({
      guideId: guide.id,
      procedureId: COOLANT,
      stepIndex: 2,
    });
  });

  test('the first step and a finished procedure leave nothing to continue', () => {
    expect(progressTargetFor(open(0), guide.id)).toBeNull();
    const store = openStore(2);
    store.getState().dispatch({ type: SessionEventType.end });
    expect(progressTargetFor(store.getState().viewer!, guide.id)).toBeNull();
  });

  test('exploring keeps the procedure to resume', () => {
    const store = openStore(3);
    store.getState().explore();
    expect(progressTargetFor(store.getState().viewer!, guide.id)).toEqual({
      guideId: guide.id,
      procedureId: COOLANT,
      stepIndex: 3,
    });
  });
});
