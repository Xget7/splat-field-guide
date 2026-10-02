import type { Pack } from '../../../../../apps/field-guide/src/domain/pack';
import { SessionEventType } from '../../../../../apps/field-guide/src/domain/session';
import { bundledPack } from '../../../../../apps/field-guide/src/modules/packs/bundledPack';
import {
  answeredExchanges,
  EntryKind,
  initialViewerState,
  ExchangePhase,
  reduceViewer,
  ViewerActionType,
  type ViewerAction,
  type ViewerState,
} from '../../../../../apps/field-guide/src/features/viewer/model/viewerState';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack: Pack = bundledPack.pack;
const run = (state: ViewerState, ...actions: ViewerAction[]) =>
  actions.reduce(
    (current, action) => reduceViewer(current, action, pack),
    state,
  );
const ask = (question: string): ViewerAction => ({
  type: ViewerActionType.ask,
  question,
  id: 1,
});
const session = (
  type: typeof SessionEventType.next | typeof SessionEventType.repeat,
): ViewerAction => ({ type: ViewerActionType.session, event: { type } });

describe('reduceViewer', () => {
  const coolant = initialViewerState('check-coolant', 1, pack);

  it('opens on the requested step with nothing said yet', () => {
    expect(coolant.session).toEqual({
      procedureId: 'check-coolant',
      stepIndex: 1,
      selectedPart: null,
    });
    expect(coolant.exchange).toBeNull();
  });

  it('applies what a question asks for and keeps the exchange', () => {
    const state = run(coolant, ask('  Where is the battery? '));
    expect(state.session.selectedPart).toBe('battery');
    expect(state.exchange).toEqual({
      question: 'Where is the battery?',
      reply: pack.parts.find(part => part.id === 'battery')?.summary,
      caution: '',
      id: 1,
      phase: ExchangePhase.done,
    });
  });

  it('drops the exchange once a button moves the session on', () => {
    const state = run(coolant, ask('where is the battery'), session('next'));
    expect(state.session.stepIndex).toBe(2);
    expect(state.exchange).toBeNull();
  });

  it('asks to frame again on repeat even when the session stays put', () => {
    const state = run(coolant, session('repeat'));
    expect(state.session).toBe(coolant.session);
    expect(state.frameRequest).toBe(coolant.frameRequest + 1);
    expect(run(coolant, ask('repeat')).frameRequest).toBe(
      coolant.frameRequest + 1,
    );
  });

  it('ignores a blank question', () => {
    expect(run(coolant, ask('   '))).toBe(coolant);
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

  const begin = (id: number, question = 'What does it do?'): ViewerAction => ({
    type: ViewerActionType.begin,
    id,
    question,
  });
  const partial = (id: number): ViewerAction => ({
    type: ViewerActionType.partial,
    id,
    partial: { part: 'battery', reply: 'It supplies' },
  });
  const answer = (id: number): ViewerAction => ({
    type: ViewerActionType.answer,
    id,
    answer: {
      reply: 'It supplies the starter.',
      caution: 'Keep sparks away.',
      part: 'battery',
      event: { type: SessionEventType.select, partId: 'battery' },
    },
  });

  it('moves from pending to streaming with a highlight, then done', () => {
    const pending = run(coolant, begin(1));
    expect(pending.exchange).toMatchObject({
      id: 1,
      phase: ExchangePhase.pending,
      reply: '',
    });
    const streaming = run(pending, partial(1));
    expect(streaming.exchange).toMatchObject({
      id: 1,
      phase: ExchangePhase.streaming,
      reply: 'It supplies',
    });
    expect(streaming.session.selectedPart).toBe('battery');
    const done = run(streaming, answer(1));
    expect(done.exchange).toMatchObject({
      phase: ExchangePhase.done,
      reply: 'It supplies the starter.',
      caution: 'Keep sparks away.',
    });
  });

  it('ignores old partials and answers when a newer question is pending', () => {
    const state = run(coolant, begin(1), begin(2));
    expect(run(state, partial(1), answer(1))).toBe(state);
    expect(run(state, answer(2)).exchange?.phase).toBe(ExchangePhase.done);
  });

  it.each([
    session('next'),
    session('repeat'),
    { type: ViewerActionType.cancel } as ViewerAction,
    ask('repeat'),
  ])('rejects late answers after another action: %o', action => {
    const state = run(coolant, begin(1), action);
    expect(run(state, partial(1), answer(1))).toBe(state);
  });

  it('a no-op session action still cancels a pending exchange', () => {
    const last = run(
      initialViewerState('check-coolant', 4, pack),
      begin(1),
      session('next'),
    );
    expect(last.exchange).toBeNull();
    expect(run(last, answer(1))).toBe(last);
  });

  it('ignores partials and duplicate completion once done', () => {
    const done = run(coolant, begin(1), answer(1));
    expect(run(done, partial(1), answer(1))).toBe(done);
  });

  it('does not retain a provisional highlight on a final answer with no event', () => {
    const done = run(coolant, begin(1), partial(1), {
      type: ViewerActionType.answer,
      id: 1,
      answer: { reply: 'Not covered.', caution: '', part: null, event: null },
    });
    expect(done.session).toBe(coolant.session);
  });

  it('repeat is applied once at completion and keeps its exact caution', () => {
    const done = run(
      coolant,
      begin(1),
      {
        type: ViewerActionType.partial,
        id: 1,
        partial: { reply: '', part: null },
      },
      {
        type: ViewerActionType.answer,
        id: 1,
        answer: {
          reply: 'The exact step.',
          caution: 'The exact caution.',
          part: 'coolant-reservoir',
          event: { type: SessionEventType.repeat },
        },
      },
    );
    expect(done.frameRequest).toBe(coolant.frameRequest + 1);
    expect(done.exchange).toMatchObject({
      reply: 'The exact step.',
      caution: 'The exact caution.',
    });
  });

  it('blank async questions do not disturb the current exchange', () => {
    const done = run(coolant, ask('battery'));
    expect(run(done, begin(2, '   '))).toBe(done);
  });

  it('cancel keeps finished answers available for spoken follow-ups', () => {
    const done = run(coolant, begin(1), answer(1));
    expect(run(done, { type: ViewerActionType.cancel })).toBe(done);
  });

  it('cancel restores the session before a provisional highlight', () => {
    const canceled = run(coolant, begin(1), partial(1), {
      type: ViewerActionType.cancel,
    });
    expect(canceled.session).toBe(coolant.session);
    expect(canceled.exchange).toBeNull();
    expect(canceled.answerSession).toBeNull();
  });

  it('keeps the conversation in order: steps as shown, then each answer', () => {
    const state = run(
      coolant,
      begin(1),
      answer(1),
      session('next'),
      session('repeat'),
      begin(2),
    );
    expect(
      state.thread.map(entry =>
        entry.kind === EntryKind.step
          ? entry.card.stepNumber
          : entry.exchange.question,
      ),
    ).toEqual([2, 'What does it do?', 3]);
    expect(answeredExchanges(state).map(done => done.id)).toEqual([1]);
    // Cancelled, the second question leaves the thread as it was before it was asked.
    const canceled = run(state, { type: ViewerActionType.cancel });
    expect(canceled.thread).toEqual(state.thread);
    expect(canceled.exchange).toBeNull();
  });

  it('cancel brings back the answer that was live before the question', () => {
    const done = run(coolant, begin(1), answer(1));
    const canceled = run(done, begin(2), { type: ViewerActionType.cancel });
    expect(canceled.exchange).toBe(done.exchange);
    expect(canceled.thread).toEqual(done.thread);
  });
});
