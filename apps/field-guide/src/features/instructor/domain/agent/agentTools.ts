import { partKnowledge, searchParts } from './partKnowledge';
import { partClarification } from '../partReference';
import type { ManualIndex, PartVectorIndex } from '../../../semantic';
import { AgentToolCopy } from './agentCopy';
import { findPart, findProcedure, type Pack } from '../../../pack/pack';
import {
  currentProcedure,
  currentStep,
  reduce,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../../../guide';

export const AgentTool = {
  showPart: 'show_part',
  searchParts: 'search_parts',
  getPart: 'get_part',
  searchManual: 'search_manual',
  getManualPage: 'get_manual_page',
  similarParts: 'find_similar_parts',
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
export interface ToolKnowledge {
  readonly manuals?: ManualIndex;
  readonly vectors?: PartVectorIndex;
}
export type KnowledgeLoader = (pack: Pack) => Promise<ToolKnowledge>;
const Description = {
  [AgentTool.searchManual]:
    'Search the complete installed KUKA manuals by operator wording. Results retain edition, source digest and PDF page. Do not transfer instructions across model families.',
  [AgentTool.getManualPage]:
    'Read the full text of an exact source PDF page. Retain its edition and applicability qualifications.',
  [AgentTool.similarParts]:
    'Compare prepared image or text embeddings for a known component with other components. Scores establish similarity only, never identity, flow, support or any physical relationship.',

  [AgentTool.searchParts]:
    'Find parts by name, alias or id. Multiple matches require clarification. Use within_part_id only for an explicit assembly. Does not move anything.',
  [AgentTool.getPart]:
    'Read exact prepared part facts, hierarchy, directed relations and source evidence by stable id. Does not change the scene.',
  [AgentTool.showPart]:
    'Select a component only after search_parts uniquely resolves the operator wording. Never guess an id for an ambiguous name; ask which machine first.',
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
/** Steps are numbered from one wherever the agent reads or names them. */
export const FIRST_STEP_NUMBER = 1;
export function agentToolSpecs(pack: Pack): AgentToolSpec[] {
  return Object.values(AgentTool).map(name => {
    const properties: Record<string, unknown> = {};
    if (
      name === AgentTool.showPart ||
      name === AgentTool.getPart ||
      name === AgentTool.similarParts
    ) {
      properties.part_id = {
        type: 'string',
        description: ParameterDescription.partId,
        enum: pack.parts.map(part => part.id),
      };
    }
    if (name === AgentTool.similarParts) {
      properties.kind = {
        type: 'string',
        enum: ['image', 'text'],
        description:
          'Compare the supplied image rows or the supplied text rows.',
      };
    }
    if (name === AgentTool.searchManual) {
      properties.query = {
        type: 'string',
        description:
          'The manual question, keeping component names, section numbers and model identifiers.',
      };
    }
    if (name === AgentTool.getManualPage) {
      properties.document_id = {
        type: 'string',
        description: 'The exact source document id returned by search_manual.',
      };
      properties.pdf_page = {
        type: 'integer',
        minimum: 1,
        description: 'The one-based PDF page number returned by search_manual.',
      };
    }
    if (name === AgentTool.searchParts) {
      properties.query = {
        type: 'string',
        description:
          'Part name, alias or stable id; omit conversational filler.',
      };
      properties.within_part_id = {
        type: 'string',
        description: 'Optional explicit assembly id.',
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
        required: Object.keys(properties).filter(
          key => key !== 'within_part_id',
        ),
      },
    };
  });
}
export type ToolOutcome =
  | {
      readonly ok: true;
      readonly event: SessionEvent | null;
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
  question?: string,
  knowledge: ToolKnowledge = {},
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
  if (name === AgentTool.searchManual) {
    if (
      typeof values.query !== 'string' ||
      !values.query.trim() ||
      values.query.length > 1000
    )
      return fail(AgentToolCopy.parameters);
    if (!knowledge.manuals)
      return fail(
        'The complete source manuals are not installed on this device. Do not invent a passage.',
      );
    return {
      ok: true,
      event: null,
      state,
      result: JSON.stringify({
        matches: knowledge.manuals.search(values.query),
        qualification:
          'PDF excerpts are evidence for their own edition and model family. Confirm installed model applicability before service.',
      }),
    };
  }
  if (name === AgentTool.getManualPage) {
    if (
      typeof values.document_id !== 'string' ||
      !Number.isInteger(values.pdf_page)
    )
      return fail(AgentToolCopy.parameters);
    const page = knowledge.manuals?.page(
      values.document_id,
      values.pdf_page as number,
    );
    return page
      ? { ok: true, event: null, state, result: JSON.stringify(page) }
      : fail('The requested source PDF page is not installed.');
  }
  if (name === AgentTool.similarParts) {
    if (
      typeof values.part_id !== 'string' ||
      (values.kind !== 'image' && values.kind !== 'text')
    )
      return fail(AgentToolCopy.parameters);
    if (!knowledge.vectors)
      return fail('Prepared component embeddings are not installed.');
    const ranked = knowledge.vectors.similarParts(
      values.part_id,
      values.kind,
      5,
    );
    return ranked.ok
      ? {
          ok: true,
          event: null,
          state,
          result: JSON.stringify({
            space_id: knowledge.vectors.space.id,
            query_part_id: values.part_id,
            kind: values.kind,
            matches: ranked.matches,
            qualification:
              'Similarity is not evidence of a physical relationship or equipment identity.',
          }),
        }
      : fail(ranked.error.message);
  }
  if (question && (name === AgentTool.getPart || name === AgentTool.showPart)) {
    const clarification = partClarification(question, pack);
    if (clarification) return fail(clarification.reply);
  }
  if (name === AgentTool.getPart) {
    const data =
      typeof values.part_id === 'string'
        ? partKnowledge(pack, values.part_id)
        : null;
    return data
      ? { ok: true, event: null, state, result: JSON.stringify(data) }
      : fail(AgentToolCopy.part);
  }
  if (name === AgentTool.searchParts) {
    if (
      typeof values.query !== 'string' ||
      !values.query.trim() ||
      values.query.length > 256 ||
      (values.within_part_id !== undefined &&
        (typeof values.within_part_id !== 'string' ||
          !findPart(pack, values.within_part_id)))
    ) {
      return fail(AgentToolCopy.parameters);
    }
    return {
      ok: true,
      event: null,
      state,
      result: JSON.stringify(
        searchParts(
          pack,
          values.query,
          values.within_part_id as string | undefined,
        ),
      ),
    };
  }
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
