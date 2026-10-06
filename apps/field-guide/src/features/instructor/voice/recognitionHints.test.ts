import { fixturePack } from '../../../testing/fixturePack';
import { recognitionHintsFor } from './recognitionHints';

describe('recognitionHintsFor', () => {
  const pack = fixturePack();

  test('lists the subject, every part name and alias, and every procedure once', () => {
    const hints = recognitionHintsFor(pack);
    expect(hints[0]).toBe(pack.title);
    for (const part of pack.parts) {
      expect(hints).toEqual(
        expect.arrayContaining([part.name, ...part.aliases]),
      );
    }
    for (const procedure of pack.procedures) {
      expect(hints).toContain(procedure.title);
    }
    expect(new Set(hints).size).toBe(hints.length);
  });
});
