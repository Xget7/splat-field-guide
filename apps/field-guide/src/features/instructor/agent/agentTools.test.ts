import { stepKeyFor } from '../voice/voiceSession';
import { bundledPack } from '../../pack/bundledPack';
import { INITIAL_SESSION, reduce, SessionEventType } from '../../guide/session';
import {
  AgentTool,
  agentToolSpecs,
  runAgentTool,
  stateSentence,
} from './agentTools';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
const procedure = pack.procedures[1];
const part = pack.parts[0];
const state = reduce(
  INITIAL_SESSION,
  { type: SessionEventType.start, procedureId: procedure.id },
  pack,
);
test('tool schemas enumerate this pack and step numbers are one based', () => {
  const specs = agentToolSpecs(pack);
  expect(
    specs.find(spec => spec.name === AgentTool.showPart)?.parameters.properties
      .part_id,
  ).toEqual({ type: 'string', enum: pack.parts.map(item => item.id) });
  expect(
    specs.find(spec => spec.name === AgentTool.startProcedure)?.parameters
      .properties.procedure_id,
  ).toEqual({ type: 'string', enum: pack.procedures.map(item => item.id) });
  expect(specs.map(spec => spec.name)).toEqual(Object.values(AgentTool));
  const outcome = runAgentTool(
    AgentTool.goToStep,
    { step_number: 2 },
    state,
    pack,
  );
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) {
    throw new Error(outcome.result);
  }
  expect(outcome.event).toEqual({ type: 'goTo', stepIndex: 1 });
  expect(outcome.state.stepIndex).toBe(1);
  expect(outcome.result).toBe(
    `Step 2 of ${procedure.steps.length} in ${procedure.title}: ${procedure.steps[1].text}`,
  );
});
test('invalid tools, parameters, ids and step positions fail with a sentence', () => {
  for (const [name, parameters, session] of [
    ['unknown', {}, state],
    [AgentTool.showPart, { part_id: 'unknown' }, state],
    [AgentTool.startProcedure, { procedure_id: 'unknown' }, state],
    [AgentTool.goToStep, { step_number: 0 }, state],
    [AgentTool.goToStep, { step_number: 1.5 }, state],
    [AgentTool.goToStep, { step_number: procedure.steps.length + 1 }, state],
    [AgentTool.showPart, null, state],
    ...[
      AgentTool.nextStep,
      AgentTool.previousStep,
      AgentTool.repeatStep,
      AgentTool.goToStep,
    ].map(tool => [tool, {}, INITIAL_SESSION]),
  ] as const) {
    const outcome = runAgentTool(
      name as string,
      parameters,
      session as typeof state,
      pack,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.result).toMatch(/\.$/);
  }
});
test('state descriptions cover a step, part, both or neither and card identity ignores framing', () => {
  const sentence = `Step 1 of ${procedure.steps.length} in ${procedure.title}: ${procedure.steps[0].text}`;
  expect(stateSentence(state, pack)).toBe(sentence);
  expect(stateSentence({ ...state, selectedPart: part.id }, pack)).toBe(
    `${sentence} Showing the ${part.name}.`,
  );
  expect(
    stateSentence({ ...INITIAL_SESSION, selectedPart: part.id }, pack),
  ).toBe(`Showing the ${part.name}.`);
  expect(stateSentence(INITIAL_SESSION, pack)).toBe('No guided check is open.');
  expect(stepKeyFor(state)).toBe(`${procedure.id}:0:null`);
});
test('each tool applies the same session reducer event', () => {
  for (const [name, parameters, event] of [
    [
      AgentTool.showPart,
      { part_id: part.id },
      { type: SessionEventType.select, partId: part.id },
    ],
    [
      AgentTool.startProcedure,
      { procedure_id: procedure.id },
      { type: SessionEventType.start, procedureId: procedure.id },
    ],
    [AgentTool.nextStep, {}, { type: SessionEventType.next }],
    [AgentTool.previousStep, {}, { type: SessionEventType.back }],
    [AgentTool.repeatStep, {}, { type: SessionEventType.repeat }],
    [AgentTool.endProcedure, {}, { type: SessionEventType.end }],
  ] as const) {
    expect(runAgentTool(name, parameters, state, pack)).toEqual({
      ok: true,
      event,
      state: reduce(state, event, pack),
      result: stateSentence(reduce(state, event, pack), pack),
    });
  }
});
