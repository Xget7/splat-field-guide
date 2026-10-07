import type { Pack } from '../../features/pack/pack';
import { SessionEventType } from '../../features/guide/session';
import { bundledPack } from '../../features/pack/bundledPack';
import { createModelInstructor } from '../../features/instructor/models/modelInstructor';
import { ExchangePhase, TurnEventType } from '../../features/instructor/turn';
import { CardKind } from './guideContent';
import {
  answeredExchanges,
  EntryKind,
  initialViewerState,
  reduceViewer,
  ViewerActionType,
  type ViewerAction,
  type ViewerState,
} from './viewerState';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack: Pack = bundledPack.pack;
const run = (state: ViewerState, ...actions: ViewerAction[]) =>
  actions.reduce(
    (current, action) => reduceViewer(current, action, pack),
    state,
  );
const session = (
  type: typeof SessionEventType.next | typeof SessionEventType.repeat,
): ViewerAction => ({ type: ViewerActionType.session, event: { type } });
function ask(state: ViewerState, question: string): ViewerState {
  let next = state;
  createModelInstructor([]).ask(
    { question, state: state.session, pack, history: [] },
    event => {
      next = reduceViewer(next, { type: ViewerActionType.turn, event }, pack);
    },
  );
  return next;
}
const pending: ViewerAction = {
  type: ViewerActionType.turn,
  event: {
    type: TurnEventType.begin,
    exchange: {
      id: 2,
      question: 'Why?',
      reply: '',
      caution: '',
      part: null,
      phase: ExchangePhase.pending,
    },
  },
};

describe('viewer conversation and guide presentation', () => {
  const coolant = initialViewerState('check-coolant', 1, pack);

  it('opens on the requested step with nothing said yet', () => {
    expect(coolant.session).toEqual({
      procedureId: 'check-coolant',
      stepIndex: 1,
      selectedPart: null,
    });
    expect(coolant.exchange).toBeNull();
  });

  it('drops the exchange once a button moves the session on', () => {
    const state = run(ask(coolant, 'where is the battery'), session('next'));
    expect(state.session.stepIndex).toBe(2);
    expect(state.exchange).toBeNull();
  });

  it('requests framing again on repeat even when the session stays put', () => {
    const state = run(coolant, session('repeat'));
    expect(state.session).toBe(coolant.session);
    expect(state.frameRequest).toBe(coolant.frameRequest + 1);
    expect(ask(coolant, 'repeat').frameRequest).toBe(coolant.frameRequest + 1);
  });

  it('explores freely, then picks the guide up where it left off', () => {
    const picked = run(coolant, {
      type: ViewerActionType.session,
      event: { type: SessionEventType.select, partId: 'battery' },
    });
    const exploring = run(picked, { type: ViewerActionType.explore });
    expect(exploring.session).toEqual({
      procedureId: null,
      stepIndex: 0,
      selectedPart: 'battery',
    });
    expect(run(exploring, { type: ViewerActionType.guide }).session).toEqual(
      coolant.session,
    );
  });

  it('lists the overview only until a part replaces it', () => {
    const select = (partId: string | null): ViewerAction => ({
      type: ViewerActionType.session,
      event: { type: SessionEventType.select, partId },
    });
    const state = run(
      coolant,
      { type: ViewerActionType.explore },
      select('battery'),
      select(null),
      select('fuse-box'),
      select(null),
    );
    expect(
      state.thread.map(entry =>
        entry.kind === EntryKind.step ? entry.card.kind : entry.kind,
      ),
    ).toEqual([
      CardKind.procedure,
      CardKind.part,
      CardKind.part,
      CardKind.overview,
    ]);
  });

  it('forgets the guide set aside once another procedure starts', () => {
    const started = run(
      coolant,
      { type: ViewerActionType.explore },
      {
        type: ViewerActionType.session,
        event: {
          type: SessionEventType.start,
          procedureId: 'check-brake-fluid',
        },
      },
    );
    expect(started.resume).toBeNull();
    expect(run(started, { type: ViewerActionType.guide })).toBe(started);
  });

  it('returns the same state for an event that changes nothing', () => {
    const last = initialViewerState('check-coolant', 4, pack);
    expect(run(last, session('next'))).toBe(last);
  });

  it('keeps steps and answered questions in order and restores the preceding answer on cancel', () => {
    const done = ask(coolant, 'Where is the battery?');
    const canceled = run(done, pending, {
      type: ViewerActionType.turn,
      event: { type: TurnEventType.cancel },
    });
    expect(canceled.exchange).toBe(done.exchange);
    expect(canceled.thread).toEqual(done.thread);
    const next = run(done, session('next'), session('repeat'), pending);
    expect(
      next.thread.map(entry =>
        entry.kind === EntryKind.step
          ? entry.card.stepNumber
          : entry.exchange.question,
      ),
    ).toEqual([2, 'Where is the battery?', 3]);
    expect(answeredExchanges(next).map(exchange => exchange.question)).toEqual([
      'Where is the battery?',
    ]);
  });
});

it('agent navigation preserves the question still being answered', () => {
  const current = run(initialViewerState('check-coolant', 0, pack), pending);
  const next = reduceViewer(
    current,
    { type: 'agent', event: { type: SessionEventType.next } },
    pack,
  );
  expect(next.session.stepIndex).toBe(1);
  expect(next.exchange).toBe(current.exchange);
  expect(next.thread.at(-1)).toMatchObject({
    kind: 'step',
    key: 'check-coolant:1:null',
  });
});
