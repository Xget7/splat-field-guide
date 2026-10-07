import { findPart, type Pack } from '../../pack/pack';
import {
  currentProcedure,
  currentStep,
  type SessionState,
} from '../../guide/session';
import type { PreviousExchange } from '../grounding';
import { stateSentence } from './agentTools';

export interface AgentVariables {
  readonly procedure: string;
  readonly step: string;
  readonly selected_part: string;
  readonly opening: string;
}
export const AgentOpening = { resumed: 'Back online.' } as const;
const NONE = 'none';
const HISTORY_EXCHANGES = 4;
const FIRST_STEP_NUMBER = 1;
export function agentVariables(
  state: SessionState,
  pack: Pack,
  resumed: boolean,
): AgentVariables {
  const procedure = currentProcedure(state, pack);
  const step = currentStep(state, pack);
  const part =
    state.selectedPart === null
      ? undefined
      : findPart(pack, state.selectedPart);
  return {
    procedure: procedure?.title ?? NONE,
    step: stateSentence(state, pack),
    selected_part: part?.name ?? NONE,
    opening: resumed
      ? AgentOpening.resumed
      : procedure && step
      ? `${procedure.title}. Step ${state.stepIndex + FIRST_STEP_NUMBER}: ${
          step.text
        }`
      : `What would you like to check on the ${pack.title}?`,
  };
}
export function screenUpdate(state: SessionState, pack: Pack): string {
  return `The screen now shows: ${stateSentence(state, pack)}`;
}
export function historyUpdate(history: readonly PreviousExchange[]): string {
  return history
    .slice(-HISTORY_EXCHANGES)
    .map(
      exchange =>
        `Earlier question: ${exchange.question}\nEarlier answer: ${exchange.reply}`,
    )
    .join('\n');
}
