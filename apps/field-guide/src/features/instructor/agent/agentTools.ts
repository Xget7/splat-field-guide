import { AgentToolCopy } from './agentCopy';
import { findPart, findProcedure, type Pack } from '../../pack/pack';
import {
  currentProcedure,
  currentStep,
  reduce,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../../guide/session';

export const AgentTool = {
  showPart: 'show_part',
  startProcedure: 'start_procedure',
  nextStep: 'next_step',
  previousStep: 'previous_step',
  repeatStep: 'repeat_step',
  goToStep: 'go_to_step',
  endProcedure: 'end_procedure',
} as const;
export type AgentTool = (typeof AgentTool)[keyof typeof AgentTool];
export interface AgentToolSpec {
  readonly name: AgentTool;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, unknown>>;
    readonly required: readonly string[];
  };
}
const Description = {
  [AgentTool.showPart]:
    'Call when the user asks about one named part: to see or find it, or how to check, fill or change it.',
  [AgentTool.startProcedure]:
    'Call when the user asks to begin a guided check or the parts tour.',
  [AgentTool.nextStep]:
    'Call when the user asks to continue to the next step of the open procedure.',
  [AgentTool.previousStep]:
    'Call when the user asks to return to the previous step of the open procedure.',
  [AgentTool.repeatStep]:
    'Call when the user asks to repeat the current step of the open procedure.',
  [AgentTool.goToStep]:
    'Call when the user asks to move to a numbered step of the open procedure.',
  [AgentTool.endProcedure]:
    'Call when the user asks to end the open procedure.',
} as const;
const ParameterDescription = {
  partId: 'The id of the part to show.',
  procedureId: 'The id of the procedure to begin.',
  stepNumber: 'The step number, counting from 1.',
} as const;
const FIRST_STEP_NUMBER = 1;
export function agentToolSpecs(pack: Pack): AgentToolSpec[] {
  return Object.values(AgentTool).map(name => {
    const properties: Record<string, unknown> = {};
    if (name === AgentTool.showPart) {
      properties.part_id = {
        type: 'string',
        description: ParameterDescription.partId,
        enum: pack.parts.map(part => part.id),
      };
    }
    if (name === AgentTool.startProcedure) {
      properties.procedure_id = {
        type: 'string',
        description: ParameterDescription.procedureId,
        enum: pack.procedures.map(procedure => procedure.id),
      };
    }
    if (name === AgentTool.goToStep) {
      properties.step_number = {
        type: 'integer',
        description: ParameterDescription.stepNumber,
        minimum: FIRST_STEP_NUMBER,
      };
    }
    return {
      name,
      description: Description[name],
      parameters: {
        type: 'object',
        properties,
        required: Object.keys(properties),
      },
    };
  });
}
export type ToolOutcome =
  | {
      readonly ok: true;
      readonly event: SessionEvent;
      readonly state: SessionState;
      readonly result: string;
    }
  | { readonly ok: false; readonly result: string };
export function stateSentence(state: SessionState, pack: Pack): string {
  const procedure = currentProcedure(state, pack);
  const step = currentStep(state, pack);
  const part =
    state.selectedPart === null
      ? undefined
      : findPart(pack, state.selectedPart);
  const shown = part ? AgentToolCopy.shownPart(part.name) : '';
  if (procedure && step) {
    return [
      AgentToolCopy.shownStep(
        state.stepIndex + FIRST_STEP_NUMBER,
        procedure.steps.length,
        procedure.title,
        step.text,
      ),
      shown,
    ]
      .filter(Boolean)
      .join(' ');
  }
  return shown || AgentToolCopy.noProcedure;
}
export function runAgentTool(
  name: string,
  parameters: unknown,
  state: SessionState,
  pack: Pack,
): ToolOutcome {
  const fail = (result: string): ToolOutcome => ({ ok: false, result });
  if (!Object.values(AgentTool).includes(name as AgentTool)) {
    return fail(AgentToolCopy.unknown);
  }
  if (
    parameters === null ||
    typeof parameters !== 'object' ||
    Array.isArray(parameters)
  ) {
    return fail(AgentToolCopy.parameters);
  }
  const values = parameters as Record<string, unknown>;
  let event: SessionEvent;
  if (name === AgentTool.showPart) {
    if (typeof values.part_id !== 'string' || !findPart(pack, values.part_id)) {
      return fail(AgentToolCopy.part);
    }
    event = { type: SessionEventType.select, partId: values.part_id };
  } else if (name === AgentTool.startProcedure) {
    if (
      typeof values.procedure_id !== 'string' ||
      !findProcedure(pack, values.procedure_id)
    ) {
      return fail(AgentToolCopy.procedure);
    }
    event = { type: SessionEventType.start, procedureId: values.procedure_id };
  } else if (name === AgentTool.endProcedure) {
    event = { type: SessionEventType.end };
  } else {
    const procedure = currentProcedure(state, pack);
    if (!procedure) {
      return fail(AgentToolCopy.closed);
    }
    if (name === AgentTool.goToStep) {
      const number = values.step_number;
      if (
        typeof number !== 'number' ||
        !Number.isInteger(number) ||
        number < FIRST_STEP_NUMBER ||
        number > procedure.steps.length
      ) {
        return fail(AgentToolCopy.step);
      }
      event = {
        type: SessionEventType.goTo,
        stepIndex: number - FIRST_STEP_NUMBER,
      };
    } else {
      const types = {
        [AgentTool.nextStep]: SessionEventType.next,
        [AgentTool.previousStep]: SessionEventType.back,
        [AgentTool.repeatStep]: SessionEventType.repeat,
      } as const;
      event = { type: types[name as keyof typeof types] };
    }
  }
  const next = reduce(state, event, pack);
  return { ok: true, event, state: next, result: stateSentence(next, pack) };
}
