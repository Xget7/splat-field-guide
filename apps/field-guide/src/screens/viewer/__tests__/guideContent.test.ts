import { fixturePack } from '../src/domain/testing/fixturePack';
import {
  INITIAL_SESSION,
  reduce,
  SessionEventType,
} from '../src/domain/session';
import { TOUR_ID } from '../src/domain/tour';
import {
  CardKind,
  cardContentFor,
  nextEventFor,
  partIdForLabel,
  procedureRowsFor,
} from '../src/ui/guideContent';

const pack = fixturePack();
const start = (procedureId = TOUR_ID) =>
  reduce(INITIAL_SESSION, { type: SessionEventType.start, procedureId }, pack);

test('tour content follows its part with one-based progress and first Back disabled', () => {
  const state = start();
  expect(cardContentFor(state, pack)).toEqual({
    kind: CardKind.part,
    title: 'Coolant reservoir',
    body: 'Coolant reservoir summary',
    caution: '',
    stepNumber: 1,
    stepCount: 8,
    selected: false,
    backDisabled: true,
    nextDisabled: false,
    nextLabel: 'Next',
  });
  const next = reduce(state, nextEventFor(state, pack), pack);
  expect(cardContentFor(next, pack)).toMatchObject({
    title: 'Power steering reservoir',
    stepNumber: 2,
    backDisabled: false,
  });
});

test('authored steps show the part names, instructions and caution', () => {
  expect(cardContentFor(start('check-coolant'), pack)).toMatchObject({
    kind: CardKind.procedure,
    title: 'Engine',
    body: 'Step engine-cold',
    caution: 'Only with the engine cold.',
    stepCount: 3,
  });
});

test.each([
  [[], 'Check the coolant level'],
  [['coolant-reservoir'], 'Coolant reservoir'],
  [
    ['power-steering-reservoir', 'coolant-reservoir'],
    'Power steering reservoir, Coolant reservoir',
  ],
])(
  'authored title uses step parts in order or falls back: %j',
  (parts, title) => {
    const authoredPack = {
      ...pack,
      procedures: pack.procedures.map(procedure => ({
        ...procedure,
        steps: procedure.steps.map(step => ({ ...step, parts })),
      })),
    };
    expect(cardContentFor(start('check-coolant'), authoredPack)).toMatchObject({
      kind: CardKind.procedure,
      title,
      body: 'Step engine-cold',
    });
  },
);

test('picker rows preserve pack order, counts and current procedure', () => {
  expect(procedureRowsFor(start('check-coolant'), pack)).toEqual([
    {
      id: TOUR_ID,
      title: 'Parts tour',
      stepCountLabel: '8 steps',
      current: false,
    },
    {
      id: 'check-coolant',
      title: 'Check the coolant level',
      stepCountLabel: '3 steps',
      current: true,
    },
    {
      id: 'check-brake-fluid',
      title: 'Check the brake fluid level',
      stepCountLabel: '2 steps',
      current: false,
    },
    {
      id: 'check-power-steering-fluid',
      title: 'Check the power steering fluid level',
      stepCountLabel: '2 steps',
      current: false,
    },
  ]);
});

test('picker current row follows the procedure despite navigation and selection', () => {
  expect(
    procedureRowsFor(
      { ...start(), stepIndex: 3, selectedPart: 'battery' },
      pack,
    )
      .filter(row => row.current)
      .map(row => row.id),
  ).toEqual([TOUR_ID]);
  expect(procedureRowsFor(INITIAL_SESSION, pack).some(row => row.current)).toBe(
    false,
  );
  expect(
    procedureRowsFor({ ...INITIAL_SESSION, procedureId: 'unknown' }, pack).some(
      row => row.current,
    ),
  ).toBe(false);
});

test('picker labels a single step in the singular', () => {
  const singleStepPack = {
    ...pack,
    procedures: [
      { ...pack.procedures[1], steps: [pack.procedures[1].steps[0]] },
    ],
  };
  expect(
    procedureRowsFor(start('check-coolant'), singleStepPack)[0].stepCountLabel,
  ).toBe('1 step');
});

test('selection preserves progress and caution, and repeat restores step content', () => {
  const state = start('check-coolant');
  const selected = reduce(
    state,
    { type: SessionEventType.select, partId: 'battery' },
    pack,
  );
  expect(cardContentFor(selected, pack)).toMatchObject({
    kind: CardKind.part,
    title: 'Battery',
    body: 'Battery summary',
    selected: true,
    stepNumber: 1,
    caution: 'Only with the engine cold.',
  });
  expect(
    cardContentFor(
      reduce(selected, { type: SessionEventType.repeat }, pack),
      pack,
    ),
  ).toEqual(cardContentFor(state, pack));
});

test.each([TOUR_ID, 'check-coolant'])(
  'last Next restarts the same procedure: %s',
  procedureId => {
    const procedure = pack.procedures.find(item => item.id === procedureId)!;
    const last = {
      ...start(procedureId),
      stepIndex: procedure.steps.length - 1,
      selectedPart: 'battery',
    };
    expect(cardContentFor(last, pack).nextLabel).toBe('Start over');
    expect(reduce(last, nextEventFor(last, pack), pack)).toEqual(
      start(procedureId),
    );
  },
);

test('an ended session has overview content and disabled navigation', () => {
  expect(cardContentFor(INITIAL_SESSION, pack)).toMatchObject({
    kind: CardKind.overview,
    title: pack.title,
    stepCount: 0,
    backDisabled: true,
    nextDisabled: true,
  });
});

test('labels map to exact parts, with zero clearing and unknown labels ignored', () => {
  expect(partIdForLabel(6, pack)).toBe('engine');
  expect(partIdForLabel(7, pack)).toBe('valve-cover');
  expect(partIdForLabel(0, pack)).toBeNull();
  expect(partIdForLabel(255, pack)).toBeUndefined();
});
