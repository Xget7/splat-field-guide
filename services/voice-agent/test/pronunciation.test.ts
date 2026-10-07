import assert from 'node:assert/strict';
import test from 'node:test';
import { pronunciationRules } from '../src/pronunciation.ts';

test('equipment terms and abbreviations have spoken aliases', () => {
  const aliases = Object.fromEntries(pronunciationRules.map(rule => [rule.string_to_replace, rule.alias]));
  assert.deepEqual(aliases, {
    Gol: 'goal', VW: 'V W', Nm: 'newton meters', psi: 'P S I',
    '°C': 'degrees Celsius', mm: 'millimeters', MIN: 'minimum', MAX: 'maximum',
    VIN: 'V I N', EA111: 'E A one one one', '5W-40': 'five W forty',
  });
  for (const rule of pronunciationRules) {
    assert.equal(rule.type, 'alias');
    assert.ok(rule.alias.trim());
  }
});
