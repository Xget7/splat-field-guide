import { mergeSwitchStep } from './switchSteps';
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
test('piece updates keep the card order and only the latest switch is shown', () => {
  const readyVoice = { ...voice, state: SwitchStepState.ready };
  const starting = mergeSwitchStep(mergeSwitchStep([], voice), answers);
  const ready = mergeSwitchStep(starting, readyVoice);
  expect(ready).toEqual([readyVoice, answers]);
  expect(mergeSwitchStep(ready, { ...voice, switchId: 0 })).toBe(ready);
  const nextSwitch = { ...answers, switchId: 2 };
  expect(mergeSwitchStep(ready, nextSwitch)).toEqual([nextSwitch]);
});
