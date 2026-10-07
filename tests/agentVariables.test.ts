import { bundledPack } from '../apps/field-guide/src/features/pack/bundledPack';
import { INITIAL_SESSION } from '../apps/field-guide/src/features/guide/session';
import {
  agentVariables,
  historyUpdate,
  screenUpdate,
} from '../apps/field-guide/src/features/instructor/agent/agentVariables';
import { stateSentence } from '../apps/field-guide/src/features/instructor/agent/agentTools';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
test('openings reflect exploration, a step or a resumed conversation', () => {
  expect(agentVariables(INITIAL_SESSION, pack, false)).toEqual({
    procedure: 'none',
    step: 'No guided check is open.',
    selected_part: 'none',
    opening: `What would you like to check on the ${pack.title}?`,
  });
  const procedure = pack.procedures[1];
  const state = {
    procedureId: procedure.id,
    stepIndex: 1,
    selectedPart: pack.parts[0].id,
  };
  expect(agentVariables(state, pack, false)).toEqual({
    procedure: procedure.title,
    step: stateSentence(state, pack),
    selected_part: pack.parts[0].name,
    opening: `${procedure.title}. Step 2: ${procedure.steps[1].text}`,
  });
  expect(agentVariables(state, pack, true).opening).toBe('Back online.');
  expect(screenUpdate(state, pack)).toBe(
    `The screen now shows: ${stateSentence(state, pack)}`,
  );
});
test('history context includes only the last four exchanges in order', () => {
  const history = Array.from({ length: 5 }, (_, id) => ({
    question: `Q${id}`,
    reply: `A${id}`,
  }));
  expect(historyUpdate(history)).toBe(
    history
      .slice(-4)
      .map(
        item =>
          `Earlier question: ${item.question}\nEarlier answer: ${item.reply}`,
      )
      .join('\n'),
  );
  expect(historyUpdate([])).toBe('');
});
