import { findPart, type Pack } from '../../../pack/pack';
import {
  currentProcedure,
  currentStep,
  type SessionState,
} from '../../../guide';
import type { PreviousExchange } from '../grounding';
import { HistoryTurns } from '../turn/history';
import { FIRST_STEP_NUMBER, stateSentence } from './agentTools';
import { AgentContextCopy, AgentOpening } from './agentCopy';

export { AgentOpening } from './agentCopy';

export interface AgentVariables {
  readonly organization?: string;
  readonly pack_id?: string;
  readonly pack_version?: string;
  readonly selected_part_id?: string;
  readonly procedure_id?: string;
  readonly procedure: string;
  readonly step: string;
  readonly selected_part: string;
  readonly opening: string;
}
const NONE = 'none';
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
    organization: 'Miris',
    pack_id: pack.packId,
    pack_version: String(pack.packVersion),
    selected_part_id: part?.id ?? NONE,
    procedure_id: procedure?.id ?? NONE,
    procedure: procedure?.title ?? NONE,
    step: stateSentence(state, pack),
    selected_part: part?.name ?? NONE,
    opening: resumed
      ? AgentOpening.resumed
      : procedure && step
      ? AgentOpening.step(procedure.title, state.stepIndex + FIRST_STEP_NUMBER)
      : AgentOpening.exploration(pack.title),
  };
}
export function screenUpdate(state: SessionState, pack: Pack): string {
  if (state.selectedParts)
    return AgentContextCopy.screen(
      `${stateSentence(state, pack)} Selected part ids: ${JSON.stringify(
        state.selectedParts,
      )}. Pack: ${pack.packId}/${pack.packVersion}.`,
    );
  return AgentContextCopy.screen(
    `${stateSentence(state, pack)} Selected part id: ${
      state.selectedPart ?? NONE
    }. Pack: ${pack.packId}/${pack.packVersion}.`,
  );
}
export function historyUpdate(history: readonly PreviousExchange[]): string {
  return history
    .slice(-HistoryTurns.agent)
    .map(exchange =>
      AgentContextCopy.exchange(exchange.question, exchange.reply),
    )
    .join('\n');
}

export const COURSE_CHAT_CONTEXT =
  'The operator is in a course chat. Navigation tools propose cards; they do not open a 3D scene. The operator must choose Navigate to 3D before a proposed component or procedure is shown. You may propose several uniquely resolved components. Never claim a proposed view is already open.';
