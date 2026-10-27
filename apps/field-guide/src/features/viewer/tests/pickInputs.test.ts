import { bundledPack } from '../../pack/bundledPack';
import { isCurrentPick, type PickInputs } from '../domain/pickInputs';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const VIEW = { id: 'view' };
const BEFORE: PickInputs<typeof VIEW> = {
  generation: 1,
  session: { procedureId: 'check-coolant', stepIndex: 2, selectedPart: null },
  pack: bundledPack.pack,
  view: VIEW,
  frameRequest: 0,
  closeUp: false,
  size: { width: 800, height: 600 },
};

describe('pick result', () => {
  test('applies while the picture and the step it was picked on are unchanged', () => {
    expect(
      isCurrentPick(BEFORE, { ...BEFORE, session: { ...BEFORE.session } }),
    ).toBe(true);
  });

  test.each<[string, Partial<PickInputs<typeof VIEW>>]>([
    ['a newer pick', { generation: 2 }],
    ['another step', { session: { ...BEFORE.session, stepIndex: 3 } }],
    [
      'another selected part',
      { session: { ...BEFORE.session, selectedPart: 'radiator-cap' } },
    ],
    ['a reframe', { frameRequest: 1 }],
    ['a close-up', { closeUp: true }],
    ['a resize', { size: { width: 800, height: 600 } }],
    ['a new view', { view: { id: 'view' } }],
  ])('is stale after %s', (_, change) => {
    expect(isCurrentPick(BEFORE, { ...BEFORE, ...change })).toBe(false);
  });
});
