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
