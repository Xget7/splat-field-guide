import { fixturePack } from '@tests/fixturePack';
import { INITIAL_SESSION } from '../../guide';
import { runAgentTool } from '../domain/agent/agentTools';

const base = fixturePack();
const pack = {
  ...base,
  parts: [
    ...base.parts,
    {
      ...base.parts[0],
      id: 'r01-welder',
      name: 'R01 welding tool',
      aliases: ['welder'],
      parent: base.parts[0].id,
    },
    {
      ...base.parts[0],
      id: 'r02-welder',
      name: 'R02 welding tool',
      aliases: ['welder'],
      parent: base.parts[1].id,
    },
  ],
  relations: [
    {
      type: 'feeds' as const,
      from: 'r01-welder',
      to: 'r02-welder',
      evidence: {
        kind: 'authored' as const,
        source: 'Reviewed training scenario, not observed production.',
      },
    },
  ],
};

test('name search preserves ambiguous candidates and never changes selection', () => {
  const result = runAgentTool(
    'search_parts',
    { query: 'welder' },
    INITIAL_SESSION,
    pack,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.result);
  expect(result.event).toBeNull();
  expect(result.state).toBe(INITIAL_SESSION);
  const data = JSON.parse(result.result);
  expect(data.matches.map((part: { id: string }) => part.id)).toEqual([
    'r01-welder',
    'r02-welder',
  ]);
  expect(data.needs_clarification).toBe(true);
});

test('explicit assembly narrows a name search; unknown scope cannot broaden it', () => {
  const result = runAgentTool(
    'search_parts',
    { query: 'welder', within_part_id: base.parts[0].id },
    INITIAL_SESSION,
    pack,
  );
  expect(
    JSON.parse(result.result).matches.map((part: { id: string }) => part.id),
  ).toEqual(['r01-welder']);
  expect(
    runAgentTool(
      'search_parts',
      { query: 'welder', within_part_id: 'unknown' },
      INITIAL_SESSION,
      pack,
    ).ok,
  ).toBe(false);
});

test('exact lookup returns stable identity, hierarchy and sourced directed relations', () => {
  const result = runAgentTool(
    'get_part',
    { part_id: 'r02-welder' },
    INITIAL_SESSION,
    pack,
  );
  expect(result.ok).toBe(true);
  const data = JSON.parse(result.result);
  expect(data.part.id).toBe('r02-welder');
  expect(data.relations[0]).toMatchObject({
    direction: 'incoming',
    other: { id: 'r01-welder' },
    evidence: { source: pack.relations[0].evidence.source },
  });
  expect(data.pack_id).toBe(pack.packId);
  expect(data.pack_version).toBe(pack.packVersion);
  expect(
    runAgentTool('get_part', { part_id: 'missing' }, INITIAL_SESSION, pack).ok,
  ).toBe(false);
});
