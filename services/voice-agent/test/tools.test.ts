import assert from 'node:assert/strict';
import test from 'node:test';
import { agentToolSpecs } from '../../../apps/field-guide/src/features/instructor/agent/agentTools.ts';
import { buildToolConfigs, CLIENT_TOOL_TYPE, TOOL_TIMEOUT_SECONDS } from '../src/tools.ts';
import { pack } from './pack.ts';

test('pack tools wait for screen results with a bounded timeout', () => {
  const tools = buildToolConfigs(pack);
  assert.deepEqual(tools.map(tool => tool.name), agentToolSpecs(pack).map(tool => tool.name));
  for (const tool of tools) {
    assert.equal(tool.type, CLIENT_TOOL_TYPE);
    assert.equal(tool.expects_response, true);
    assert.equal(tool.response_timeout_secs, TOOL_TIMEOUT_SECONDS);
  }
});
