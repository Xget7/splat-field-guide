import { fixturePack } from '@tests/fixturePack';
import { cloudInstructions } from '../data/answerers/cloudAnswerer';
import { ReplyFormat, rulesFor } from '../domain/grounding';

test('instructions include the supplied synthetic identity', () => {
  const pack = fixturePack();
  expect(cloudInstructions(pack)).toContain(pack.title);
});

test('instructions are strict structured rules followed by every note and guided check', () => {
  const pack = fixturePack();
  const instructions = cloudInstructions(pack);
  expect(
    instructions.startsWith(rulesFor(pack, ReplyFormat.structured).join('\n')),
  ).toBe(true);
  expect(instructions).toContain(
    'Part: Coolant reservoir (also called coolant tank, expansion tank)',
  );
  expect(instructions).toContain(
    'faults: A battery that keeps going flat needs a charging check.',
  );
  expect(instructions).toContain(
    'Connections: is fed by Coolant reservoir (Workshop manual, cooling).',
  );
  expect(instructions).toContain(
    'Check the coolant level: Step engine-cold Caution: Only with the engine cold. Step locate Step read-level',
  );
});

test('a visible routed hose connection does not claim media flow', () => {
  const pack = fixturePack();
  const relation = {
    type: 'routes' as const,
    from: 'coolant-reservoir',
    to: 'engine',
    evidence: {
      kind: 'authored' as const,
      source: 'Visible route, media unknown',
    },
  };
  const instructions = cloudInstructions({ ...pack, relations: [relation] });
  expect(instructions).toContain(
    'routes to Engine (Visible route, media unknown)',
  );
  expect(instructions).not.toContain('feeds Engine');
});
