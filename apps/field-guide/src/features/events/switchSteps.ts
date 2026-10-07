import type { SwitchStep } from './types';

const NO_STEPS: readonly SwitchStep[] = [];

export function activeSwitchSteps(
  steps: readonly SwitchStep[],
  settledId: number | null,
): readonly SwitchStep[] {
  if (
    settledId !== null &&
    steps.length > 0 &&
    steps[0].switchId <= settledId
  ) {
    return NO_STEPS;
  }
  return steps;
}

export function mergeSwitchStep(
  steps: readonly SwitchStep[],
  step: SwitchStep,
): readonly SwitchStep[] {
  const latestId = steps[0]?.switchId;
  if (latestId !== undefined && step.switchId < latestId) {
    return steps;
  }
  if (latestId !== step.switchId) {
    return [step];
  }
  const index = steps.findIndex(previous => previous.piece === step.piece);
  return index === -1
    ? [...steps, step]
    : steps.map((previous, position) => (position === index ? step : previous));
}
