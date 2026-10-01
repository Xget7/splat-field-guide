import type { Pack } from '../../../domain/pack';
import { SessionEventType } from '../../../domain/session';
import { bundledPack } from '../../../packs/bundledPack';
import {
  initialViewerState,
  reduceViewer,
  ViewerActionType,
  type ViewerAction,
  type ViewerState,
} from '../viewerState';

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

  it('returns the same state for an event that changes nothing', () => {
    const last = initialViewerState('check-coolant', 4, pack);
    expect(run(last, session('next'))).toBe(last);
  });
});
