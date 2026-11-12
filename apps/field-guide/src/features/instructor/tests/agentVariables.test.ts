import { fixturePack } from '@tests/fixturePack';
import { INITIAL_SESSION } from '../../guide';
import {
  agentVariables,
  historyUpdate,
  screenUpdate,
} from '../domain/agent/agentVariables';
import { stateSentence } from '../domain/agent/agentTools';

const pack = fixturePack();
test('openings reflect exploration, a step or a resumed conversation', () => {
  expect(agentVariables(INITIAL_SESSION, pack, false)).toEqual({
    organization: 'Miris',
    pack_id: pack.packId,
    pack_version: String(pack.packVersion),
    procedure_id: 'none',
    selected_part_id: 'none',
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
    organization: 'Miris',
    pack_id: pack.packId,
    pack_version: String(pack.packVersion),
    procedure_id: procedure.id,
    selected_part_id: pack.parts[0].id,
    procedure: procedure.title,
    step: stateSentence(state, pack),
    selected_part: pack.parts[0].name,
    opening: `Ready to help with ${procedure.title}, step 2.`,
  });
  expect(agentVariables(state, pack, true).opening).toBe('Back online.');
  expect(screenUpdate(state, pack)).toBe(
    `The screen now shows: ${stateSentence(state, pack)} Selected part id: ${
      state.selectedPart
    }. Pack: ${pack.packId}/${pack.packVersion}.`,
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
