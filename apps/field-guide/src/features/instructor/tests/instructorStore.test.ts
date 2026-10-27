import {
  createInstructorStore,
  selectSwitchSteps,
} from '../state/instructorStore';
import { fakeInstructor } from '@tests/voiceSession';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  ModeRequestType,
  SwitchPiece,
  SwitchStepState,
  VoiceSource,
  type ModeStatus,
} from '../domain/mode/modeTypes';

const ONLINE: ModeStatus = {
  mode: InstructorMode.online,
  cause: ModeCause.startup,
  voice: VoiceSource.agent,
  answers: AnswerSource.claude,
};
const SWITCH_ID = 1;
const KOKORO_STEP = {
  switchId: SWITCH_ID,
  piece: SwitchPiece.voice,
  state: SwitchStepState.starting,
  label: 'Voice: Kokoro',
};

test('settled source updates preserve progress that arrives before the switching mode', () => {
  const store = createInstructorStore();
  const { modeChanged, switchStepArrived } = store.getState();
  modeChanged(ONLINE);
  switchStepArrived(KOKORO_STEP);
  expect(selectSwitchSteps(store.getState())).toEqual([KOKORO_STEP]);
  modeChanged({ ...ONLINE, voice: VoiceSource.device });
  expect(selectSwitchSteps(store.getState())).toEqual([KOKORO_STEP]);
  modeChanged({
    ...ONLINE,
    mode: InstructorMode.switchingToOffline,
    cause: ModeCause.network,
  });
  expect(selectSwitchSteps(store.getState())).toEqual([KOKORO_STEP]);
});

test('a settled switch hides its progress until the next switch reports', () => {
  const store = createInstructorStore();
  const { modeChanged, switchStepArrived } = store.getState();
  modeChanged({
    ...ONLINE,
    mode: InstructorMode.switchingToOffline,
    cause: ModeCause.network,
  });
  switchStepArrived(KOKORO_STEP);
  modeChanged({ ...ONLINE, mode: InstructorMode.offline });
  expect(selectSwitchSteps(store.getState())).toEqual([]);
  const next = { ...KOKORO_STEP, switchId: SWITCH_ID + 1 };
  switchStepArrived(next);
  expect(selectSwitchSteps(store.getState())).toEqual([next]);
});

test.each([
  { action: 'acceptSuggestion', type: ModeRequestType.acceptSuggestion },
  { action: 'dismissSuggestion', type: ModeRequestType.dismissSuggestion },
] as const)(
  '$action forwards its request to the attached instructor',
  ({ action, type }) => {
    const store = createInstructorStore();
    expect(() => store.getState()[action]()).not.toThrow();
    const instructor = fakeInstructor();
    store.getState().attach(instructor);
    store.getState()[action]();
    expect(instructor.requestMode).toHaveBeenCalledWith({ type });
  },
);

test('attaching the same instructor again changes nothing, and reset detaches it', () => {
  const store = createInstructorStore();
  const instructor = fakeInstructor();
  const listener = jest.fn();
  store.subscribe(listener);
  store.getState().attach(instructor);
  store.getState().attach(instructor);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.getState().instructor).toBe(instructor);
  const initial = createInstructorStore().getState();
  store.getState().modeChanged({ ...ONLINE, mode: InstructorMode.offline });
  store.getState().reset();
  expect(store.getState()).toMatchObject({
    network: initial.network,
    mode: initial.mode,
    suggestion: null,
    agent: initial.agent,
    switchSteps: [],
    settledSwitchId: null,
    voice: initial.voice,
    instructor: null,
  });
});
