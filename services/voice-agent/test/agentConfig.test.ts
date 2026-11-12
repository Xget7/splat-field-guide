import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentConfig } from '../src/agentConfig.ts';
import { knowledgeDocuments } from '../src/knowledge.ts';
import { pack } from './pack.ts';
test('one English Miris agent uses managed generation, sourced RAG and only the text-only override', () => {
  const config = buildAgentConfig(pack, { voiceId: 'voice', knowledgeIds: [{ id: 'doc', name: 'Miris content' }], toolIds: ['tools'], dictionary: { id: 'terms', versionId: 'v1' } });
  const agent = config.conversation_config.agent;
  assert.equal(agent.language, 'en');
  assert.notEqual(agent.prompt.llm, 'custom-llm');
  assert.equal('custom_llm' in agent.prompt, false);
  assert.equal(agent.prompt.rag.enabled, true);
  assert.deepEqual(agent.prompt.knowledge_base, [{ id: 'doc', name: 'Miris content', type: 'text', usage_mode: 'auto' }]);
  assert.ok(agent.prompt.prompt.includes('ask which machine'));
  assert.ok(agent.prompt.prompt.includes('Answer in English only'));
  assert.ok(!agent.prompt.prompt.includes('Notes:'));
  assert.equal(config.platform_settings.auth.enable_auth, true);
  assert.deepEqual(config.platform_settings.overrides.conversation_config_override, { conversation: { text_only: true } });
});
test('prepared documents retain version, stable ids, hierarchy and relation source qualifications', () => {
  const docs = knowledgeDocuments(pack);
  assert.equal(docs.length, 1 + pack.parts.length + pack.procedures.length);
  assert.ok(docs.every(doc => doc.text.includes(`Content version: ${pack.packVersion}`)));
  const serialized = docs.map(doc => doc.text).join('\n');
  for (const relation of pack.relations) assert.ok(serialized.includes(relation.evidence.source));
  assert.ok(serialized.includes('not a complete factory survey'));
  assert.deepEqual(knowledgeDocuments(pack), docs);
});
