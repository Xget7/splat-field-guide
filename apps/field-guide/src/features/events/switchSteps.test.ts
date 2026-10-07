import { activeSwitchSteps, mergeSwitchStep } from './switchSteps';
import { SwitchPiece, SwitchStepState, type SwitchStep } from './types';

const voice: SwitchStep = {
  switchId: 1,
  piece: SwitchPiece.voice,
  state: SwitchStepState.starting,
  label: 'Voice',
};
const answers: SwitchStep = {
  switchId: 1,
  piece: SwitchPiece.answers,
  state: SwitchStepState.starting,
  label: 'Answers',
};
const FINISHED_SWITCH_ID = 1;
const NEW_SWITCH_ID = 2;

test('settled switches no longer have visible progress', () => {
  expect(activeSwitchSteps([voice, answers], FINISHED_SWITCH_ID)).toEqual([]);
});

test('a newer switch keeps its progress after an earlier switch settled', () => {
  const step = { ...voice, switchId: NEW_SWITCH_ID };
  expect(activeSwitchSteps([step], FINISHED_SWITCH_ID)).toEqual([step]);
});
test('new pieces keep their emission order', () => {
  expect(mergeSwitchStep(mergeSwitchStep([], voice), answers)).toEqual([
    voice,
    answers,
  ]);
});

test('a piece update preserves its position', () => {
  const readyVoice = { ...voice, state: SwitchStepState.ready };
  expect(mergeSwitchStep([voice, answers], readyVoice)).toEqual([
    readyVoice,
    answers,
  ]);
});

test('progress from an older switch cannot replace the current switch', () => {
  const current = { ...answers, switchId: NEW_SWITCH_ID };
  expect(mergeSwitchStep([current], voice)).toEqual([current]);
});

test('a newer switch replaces all previous progress', () => {
  const nextSwitch = { ...answers, switchId: NEW_SWITCH_ID };
  expect(mergeSwitchStep([voice, answers], nextSwitch)).toEqual([nextSwitch]);
});
