import { findPart, type Pack } from '../../pack/pack';
import {
  currentProcedure,
  currentStep,
  type SessionState,
} from '../../guide/session';
import type { PreviousExchange } from '../grounding';
import { stateSentence } from './agentTools';
import { AgentContextCopy, AgentOpening } from './agentCopy';

export { AgentOpening } from './agentCopy';

export interface AgentVariables {
  readonly procedure: string;
  readonly step: string;
  readonly selected_part: string;
  readonly opening: string;
}
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
      ? AgentOpening.step(
          procedure.title,
          state.stepIndex + FIRST_STEP_NUMBER,
          step.text,
        )
      : AgentOpening.exploration(pack.title),
  };
}
export function screenUpdate(state: SessionState, pack: Pack): string {
  return AgentContextCopy.screen(stateSentence(state, pack));
}
export function historyUpdate(history: readonly PreviousExchange[]): string {
  return history
    .slice(-HISTORY_EXCHANGES)
    .map(exchange =>
      AgentContextCopy.exchange(exchange.question, exchange.reply),
    )
    .join('\n');
}
