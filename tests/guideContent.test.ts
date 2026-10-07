import { fixturePack } from './fixturePack';
import {
  INITIAL_SESSION,
  reduce,
  SessionEventType,
} from '../apps/field-guide/src/features/guide/session';
import { TOUR_ID } from '../apps/field-guide/src/features/guide/tour';
import {
  CardKind,
  cardContentFor,
  stepRowsFor,
} from '../apps/field-guide/src/screens/viewer/guideContent';

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
    last: false,
  });
  const next = reduce(state, { type: SessionEventType.next }, pack);
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

test('selection keeps progress, drops the step caution, and repeat restores the step', () => {
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
    caution: '',
  });
  expect(
    cardContentFor(
      reduce(selected, { type: SessionEventType.repeat }, pack),
      pack,
    ),
  ).toEqual(cardContentFor(state, pack));
});

test.each([TOUR_ID, 'check-coolant'])(
  'the last step finishes instead of moving on: %s',
  procedureId => {
    const procedure = pack.procedures.find(item => item.id === procedureId)!;
    const last = {
      ...start(procedureId),
      stepIndex: procedure.steps.length - 1,
    };
    expect(cardContentFor(last, pack).last).toBe(true);
    expect(cardContentFor(start(procedureId), pack).last).toBe(false);
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

test('the step list names tour steps by part and the rest by their first sentence, then the others', () => {
  const procedure = pack.procedures.find(({ id }) => id === 'check-coolant')!;
  const twoSentences = {
    ...pack,
    procedures: [
      {
        ...procedure,
        steps: [
          { ...procedure.steps[0], text: 'Open the hood. Prop it up.' },
          ...procedure.steps.slice(1),
        ],
      },
    ],
  };
  expect(stepRowsFor(start('check-coolant'), twoSentences)[0]).toEqual({
    id: procedure.steps[0].id,
    text: 'Open the hood.',
    detail: 'Prop it up.',
    caution: procedure.steps[0].caution,
  });
  expect(stepRowsFor(start(), pack)[0]).toMatchObject({
    text: 'Coolant reservoir',
    detail: 'Coolant reservoir summary',
  });
});
