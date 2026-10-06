import { framingFor, highlightFor } from './derive';
import {
  currentStep,
  INITIAL_SESSION,
  isLastStep,
  reduce,
  SessionEvent,
  SessionEventType,
  SessionState,
  startAt,
} from './session';
import { fixturePack } from '../testing/fixturePack';

const pack = fixturePack();

const start = (procedureId: string): SessionEvent => ({
  type: SessionEventType.start,
  procedureId,
});
const select = (partId: string | null): SessionEvent => ({
  type: SessionEventType.select,
  partId,
});
const next: SessionEvent = { type: SessionEventType.next };
const back: SessionEvent = { type: SessionEventType.back };
const repeat: SessionEvent = { type: SessionEventType.repeat };
const end: SessionEvent = { type: SessionEventType.end };

const run = (events: SessionEvent[], from = INITIAL_SESSION): SessionState =>
  events.reduce((state, event) => reduce(state, event, pack), from);

describe('reduce', () => {
  it('starts a procedure at its first step', () => {
    const state = run([start('check-coolant')]);
    expect(state).toEqual({
      procedureId: 'check-coolant',
      stepIndex: 0,
      selectedPart: null,
    });
    expect(currentStep(state, pack)?.id).toBe('engine-cold');
  });

  it('restarts from the first step and drops the selection', () => {
    const state = run([
      start('check-coolant'),
      next,
      select('battery'),
      start('check-brake-fluid'),
    ]);
    expect(state).toEqual({
      procedureId: 'check-brake-fluid',
      stepIndex: 0,
      selectedPart: null,
    });
  });

  it('ignores starting an unknown procedure', () => {
    const before = run([start('check-coolant'), next]);
    expect(reduce(before, start('rotate-tyres'), pack)).toBe(before);
  });

  it('moves forward and back through the steps', () => {
    expect(run([start('check-coolant'), next, next]).stepIndex).toBe(2);
    expect(run([start('check-coolant'), next, next, back]).stepIndex).toBe(1);
  });

  it('jumps to any step of the procedure and drops the selection', () => {
    const goTo = (stepIndex: number): SessionEvent => ({
      type: SessionEventType.goTo,
      stepIndex,
    });
    const selected = run([start('check-coolant'), select('battery')]);
    expect(reduce(selected, goTo(2), pack)).toEqual({
      procedureId: 'check-coolant',
      stepIndex: 2,
      selectedPart: null,
    });
    for (const outside of [-1, 3, 1.5]) {
      expect(reduce(selected, goTo(outside), pack)).toBe(selected);
    }
    expect(reduce(INITIAL_SESSION, goTo(0), pack)).toBe(INITIAL_SESSION);
  });

  it('stays on the last step when next goes past it', () => {
    const state = run([start('check-brake-fluid'), next, next, next]);
    expect(state.stepIndex).toBe(1);
    expect(state.procedureId).toBe('check-brake-fluid');
    expect(isLastStep(state, pack)).toBe(true);
  });

  it('stays on the first step when back goes before it', () => {
    const started = run([start('check-coolant')]);
    expect(reduce(started, back, pack)).toBe(started);
    expect(isLastStep(started, pack)).toBe(false);
  });

  it('ignores next, back and repeat with no procedure', () => {
    [next, back, repeat].forEach(event =>
      expect(reduce(INITIAL_SESSION, event, pack)).toBe(INITIAL_SESSION),
    );
    expect(isLastStep(INITIAL_SESSION, pack)).toBe(false);
  });

  it('repeat keeps the step and drops a selection override', () => {
    const state = run([
      start('check-coolant'),
      next,
      select('battery'),
      repeat,
    ]);
    expect(state).toEqual({
      procedureId: 'check-coolant',
      stepIndex: 1,
      selectedPart: null,
    });
  });

  it('repeat on a plain step changes nothing', () => {
    const state = run([start('check-coolant'), next]);
    expect(reduce(state, repeat, pack)).toBe(state);
  });

  it('selects and clears a part outside a procedure', () => {
    expect(run([select('battery')]).selectedPart).toBe('battery');
    expect(run([select('battery'), select(null)])).toEqual(INITIAL_SESSION);
  });

  it('ignores selecting an unknown part', () => {
    const state = run([select('battery')]);
    expect(reduce(state, select('horn'), pack)).toBe(state);
  });

  it('keeps the selection when next cannot move', () => {
    const state = run([
      start('check-brake-fluid'),
      next,
      select('battery'),
      next,
    ]);
    expect(state.selectedPart).toBe('battery');
  });

  it('clears the selection when the step changes', () => {
    expect(
      run([start('check-coolant'), select('battery'), next]).selectedPart,
    ).toBeNull();
    expect(
      run([start('check-coolant'), next, select('battery'), back]).selectedPart,
    ).toBeNull();
  });

  it('ends the session', () => {
    expect(run([start('check-coolant'), next, select('battery'), end])).toEqual(
      INITIAL_SESSION,
    );
  });

  it('never mutates the state it was given', () => {
    const before = run([start('check-coolant')]);
    const copy = JSON.stringify(before);
    reduce(before, next, pack);
    expect(JSON.stringify(before)).toBe(copy);
  });
});

describe('highlightFor', () => {
  it('is empty with nothing going on', () => {
    expect(highlightFor(INITIAL_SESSION, pack)).toEqual([]);
  });

  it('emphasises a selected part by its label (R6)', () => {
    expect(highlightFor(run([select('battery')]), pack)).toEqual([4]);
  });

  it('emphasises the engine and the parts inside it (R8)', () => {
    expect(highlightFor(run([select('engine')]), pack)).toEqual([6, 7, 8]);
  });

  it('emphasises only a child when only the child is selected', () => {
    expect(highlightFor(run([select('valve-cover')]), pack)).toEqual([7]);
  });

  it('expands at any depth', () => {
    const deep = JSON.parse(JSON.stringify(pack));
    deep.parts[0].parent = 'valve-cover';
    expect(highlightFor(run([select('engine')]), deep)).toEqual([1, 6, 7, 8]);
  });

  it('terminates on a hand-built cycle', () => {
    const cyclic = JSON.parse(JSON.stringify(pack));
    cyclic.parts[5].parent = 'valve-cover';
    expect(highlightFor(run([select('engine')]), cyclic)).toEqual([6, 7, 8]);
  });

  it('follows the step parts of a procedure (R13)', () => {
    const state = run([start('check-coolant'), next]);
    expect(highlightFor(state, pack)).toEqual([1]);
  });

  it('expands a step that names the engine (R8, R13)', () => {
    expect(highlightFor(run([start('check-coolant')]), pack)).toEqual([
      6, 7, 8,
    ]);
  });

  it('lets a selection override the step until the step changes', () => {
    const selected = run([start('check-coolant'), next, select('battery')]);
    expect(highlightFor(selected, pack)).toEqual([4]);
    expect(highlightFor(reduce(selected, next, pack), pack)).toEqual([1]);
  });

  it('goes back to the step highlight when the selection is cleared', () => {
    const state = run([
      start('check-coolant'),
      next,
      select('battery'),
      select(null),
    ]);
    expect(highlightFor(state, pack)).toEqual([1]);
  });

  it('is empty for a state that points outside the pack', () => {
    const stale: SessionState = {
      procedureId: 'gone',
      stepIndex: 0,
      selectedPart: null,
    };
    const outOfRange: SessionState = {
      procedureId: 'check-coolant',
      stepIndex: 9,
      selectedPart: null,
    };
    expect(highlightFor(stale, pack)).toEqual([]);
    expect(highlightFor(outOfRange, pack)).toEqual([]);
  });

  it('covers each of the three procedures with a distinct reservoir (R12)', () => {
    const labels = [
      'check-coolant',
      'check-brake-fluid',
      'check-power-steering-fluid',
    ].map(id => highlightFor(run([start(id), next]), pack));
    expect(labels).toEqual([[1], [3], [2]]);
  });
});

describe('framingFor', () => {
  it('frames every part while exploring with nothing picked', () => {
    expect(framingFor(INITIAL_SESSION, pack)).toEqual({
      min: [0, 0, 0],
      max: [14, 3, 3],
    });
  });

  it('frames one part by its bounds (R9)', () => {
    expect(framingFor(run([select('battery')]), pack)).toEqual({
      min: [6, 0, 0],
      max: [7, 1, 1],
    });
  });

  it('frames the union of the engine and what is inside it', () => {
    expect(framingFor(run([select('engine')]), pack)).toEqual({
      min: [10, 0, 0],
      max: [14, 3, 3],
    });
  });

  it('unions bounds even when a child pokes out of its parent', () => {
    const wide = JSON.parse(JSON.stringify(pack));
    wide.parts[7].bounds = { min: [9, -1, 0], max: [15, 1, 1] };
    expect(framingFor(run([select('engine')]), wide)).toEqual({
      min: [9, -1, 0],
      max: [15, 3, 3],
    });
  });

  it('frames the step parts, and the selection instead once chosen (R13)', () => {
    const step = run([start('check-brake-fluid')]);
    expect(framingFor(step, pack)).toEqual({ min: [4, 0, 0], max: [5, 1, 1] });
    expect(framingFor(reduce(step, select('fuse-box'), pack), pack)).toEqual({
      min: [8, 0, 0],
      max: [9, 1, 1],
    });
  });

  it('frames a step with several parts as one box', () => {
    const multi = JSON.parse(JSON.stringify(pack));
    multi.procedures.find(
      (p: { id: string }) => p.id === 'check-brake-fluid',
    ).steps[0].parts = ['battery', 'fuse-box'];
    expect(framingFor(run([start('check-brake-fluid')]), multi)).toEqual({
      min: [6, 0, 0],
      max: [9, 1, 1],
    });
  });
});

describe('startAt', () => {
  const steps = (id: string) =>
    pack.procedures.find(procedure => procedure.id === id)?.steps.length ?? 0;

  it('opens a procedure on the step asked for', () => {
    expect(startAt('check-coolant', 2, pack)).toEqual(
      run([start('check-coolant'), next, next]),
    );
  });

  it('stops at the last step when asked for one past it', () => {
    const last = steps('check-coolant') - 1;
    expect(startAt('check-coolant', last + 3, pack).stepIndex).toBe(last);
  });

  it('opens nothing for a procedure the pack does not have', () => {
    expect(startAt('missing', 1, pack)).toBe(INITIAL_SESSION);
  });
});
