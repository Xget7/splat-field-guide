import { findPart, type Pack } from '../../domain/pack';
import {
  INITIAL_SESSION,
  SessionEventType,
  startAt,
  type SessionState,
} from '../../domain/session';
import { TOUR_ID } from '../../domain/tour';
import { bundledPack } from '../../packs/bundledPack';
import { answerFor, focusPart } from '../instructor';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack: Pack = bundledPack.pack;
const part = (id: string) => {
  const found = findPart(pack, id);
  if (found === undefined) {
    throw new Error(`no part ${id}`);
  }
  return found;
};
const coolantStep = (stepIndex: number): SessionState =>
  startAt('check-coolant', stepIndex, pack);
const select = (partId: string) => ({
  type: SessionEventType.select,
  partId,
});
const start = (procedureId: string) => ({
  type: SessionEventType.start,
  procedureId,
});

describe('answerFor', () => {
  it.each([
    ['Where is the battery?', 'battery'],
    ['where is the brake fluid', 'brake-fluid-reservoir'],
    ['What is the coolant tank?', 'coolant-reservoir'],
    ['show me the steering reservoir', 'power-steering-reservoir'],
    ['valve cover', 'valve-cover'],
  ])('shows the part "%s" names with its summary', (question, partId) => {
    expect(answerFor(question, INITIAL_SESSION, pack)).toEqual({
      reply: part(partId).summary,
      caution: '',
      part: partId,
      event: select(partId),
    });
  });

  it('explains what a named part does when asked why or what it does', () => {
    expect(
      answerFor('What does the fuse box do?', INITIAL_SESSION, pack),
    ).toEqual({
      reply: part('fuse-box').details,
      caution: '',
      part: 'fuse-box',
      event: select('fuse-box'),
    });
  });

  it.each([
    ['How do I check the coolant?', 'check-coolant'],
    ['check the brake fluid', 'check-brake-fluid'],
    ['power steering fluid steps', 'check-power-steering-fluid'],
    ['start check the coolant level', 'check-coolant'],
  ])('starts the procedure "%s" asks for at step one', (question, id) => {
    const answer = answerFor(question, INITIAL_SESSION, pack);
    const first = pack.procedures.find(p => p.id === id)?.steps[0];
    expect(answer).toEqual({
      reply: first?.text,
      caution: first?.caution,
      part: first?.parts[0] ?? null,
      event: start(id),
    });
  });

  it('reads the next step and its caution', () => {
    const answer = answerFor('next', coolantStep(2), pack);
    const step = pack.procedures.find(p => p.id === 'check-coolant')?.steps[3];
    expect(answer).toEqual({
      reply: step?.text,
      caution: step?.caution,
      part: step?.parts[0] ?? null,
      event: { type: SessionEventType.next },
    });
    expect(answer.caution).not.toBe('');
  });

  it('says so instead of moving past either end', () => {
    expect(answerFor('next', coolantStep(4), pack)).toEqual({
      reply: 'That was the last step.',
      caution: '',
      part: null,
      event: null,
    });
    expect(answerFor('back', coolantStep(0), pack)).toEqual({
      reply: 'This is the first step.',
      caution: '',
      part: null,
      event: null,
    });
  });

  it('answers about the part on screen when asked about "it"', () => {
    const state = startAt(TOUR_ID, 0, pack);
    const onScreen = focusPart(state, pack);
    expect(answerFor('What does it do?', state, pack)).toEqual({
      reply: onScreen?.details,
      caution: '',
      part: onScreen?.id ?? null,
      event: null,
    });
  });

  it('step commands identify the step subject instead of an overridden selection', () => {
    const selected = { ...coolantStep(1), selectedPart: 'battery' };
    expect(answerFor('repeat', selected, pack).part).toBe('coolant-reservoir');
    expect(answerFor('back', coolantStep(2), pack).part).toBe(
      'coolant-reservoir',
    );
    expect(answerFor('repeat', INITIAL_SESSION, pack).part).toBeNull();
  });

  it('a step with no focus part has no answer subject', () => {
    const noFocus = {
      ...pack,
      procedures: pack.procedures.map(procedure => ({
        ...procedure,
        steps: procedure.steps.map(step => ({ ...step, parts: [] })),
      })),
    };
    expect(answerFor('repeat', coolantStep(1), noFocus).part).toBeNull();
  });

  it('refuses to guess: an ambiguous word or an unknown question gets a hint', () => {
    for (const question of ['where is the fluid', 'tell me a joke', '']) {
      const answer = answerFor(question, INITIAL_SESSION, pack);
      expect(answer.event).toBeNull();
      expect(answer.part).toBeNull();
      expect(answer.reply).toMatch(/^Ask for a part or a check/);
    }
  });

  it('stops the procedure on stop', () => {
    expect(answerFor('stop', coolantStep(1), pack)).toEqual({
      reply: 'Stopped. Ask for a part or a check.',
      caution: '',
      part: null,
      event: { type: SessionEventType.end },
    });
  });
});
