import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolConfigs } from '../src/tools.ts';
import { pack } from './pack.ts';

test('the agent can select only pack parts and start only pack checks while waiting for screen results', () => {
  const tools = buildToolConfigs(pack);
  assert.deepEqual(tools.map(tool => tool.name), [
    'show_part', 'start_procedure', 'next_step', 'previous_step', 'repeat_step', 'go_to_step', 'end_procedure',
  ]);
  assert.deepEqual(tools.find(tool => tool.name === 'show_part')?.parameters.properties.part_id, {
    type: 'string', enum: pack.parts.map(part => part.id),
  });
  assert.deepEqual(tools.find(tool => tool.name === 'start_procedure')?.parameters.properties.procedure_id, {
    type: 'string', enum: pack.procedures.map(procedure => procedure.id),
  });
  assert.deepEqual(tools.find(tool => tool.name === 'go_to_step')?.parameters.properties.step_number, {
    type: 'integer', minimum: 1,
  });
  for (const tool of tools) {
    assert.equal(tool.type, 'client');
    assert.equal(tool.expects_response, true);
    assert.equal(tool.response_timeout_secs, 5);
  }
});
