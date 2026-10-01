import { findPart, type Pack } from '../../domain/pack';
import {
  INITIAL_SESSION,
  SessionEventType,
  startAt,
  type SessionState,
} from '../../domain/session';
import { TOUR_ID } from '../../domain/tour';
import { bundledPack } from '../../packs/bundledPack';
import {
  answerFor,
  ASK_DETAILS,
  ASK_NEXT,
  focusPart,
  suggestionsFor,
} from '../instructor';

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
      event: select(partId),
    });
  });

  it('explains what a named part does when asked why or what it does', () => {
    expect(
      answerFor('What does the fuse box do?', INITIAL_SESSION, pack),
    ).toEqual({
      reply: part('fuse-box').details,
      caution: '',
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
      event: start(id),
    });
  });

  it('reads the next step and its caution', () => {
    const answer = answerFor('next', coolantStep(2), pack);
    const step = pack.procedures.find(p => p.id === 'check-coolant')?.steps[3];
    expect(answer).toEqual({
      reply: step?.text,
      caution: step?.caution,
      event: { type: SessionEventType.next },
    });
    expect(answer.caution).not.toBe('');
  });

  it('says so instead of moving past either end', () => {
    expect(answerFor('next', coolantStep(4), pack)).toEqual({
      reply: 'That was the last step.',
      caution: '',
      event: null,
    });
    expect(answerFor('back', coolantStep(0), pack)).toEqual({
      reply: 'This is the first step.',
      caution: '',
      event: null,
    });
  });

  it('answers about the part on screen when asked about "it"', () => {
    const state = startAt(TOUR_ID, 0, pack);
    const onScreen = focusPart(state, pack);
    expect(answerFor(ASK_DETAILS, state, pack)).toEqual({
      reply: onScreen?.details,
      caution: '',
      event: null,
    });
  });

  it('refuses to guess: an ambiguous word or an unknown question gets a hint', () => {
    for (const question of ['where is the fluid', 'tell me a joke', '']) {
      const answer = answerFor(question, INITIAL_SESSION, pack);
      expect(answer.event).toBeNull();
      expect(answer.reply).toMatch(/^Ask for a part or a check/);
    }
  });

  it('stops the procedure on stop', () => {
    expect(answerFor('stop', coolantStep(1), pack).event).toEqual({
      type: SessionEventType.end,
    });
  });
});

describe('suggestionsFor', () => {
  it('offers details, the next step and another part during a procedure', () => {
    expect(suggestionsFor(coolantStep(1), pack)).toEqual([
      ASK_DETAILS,
      ASK_NEXT,
      'Where is the power steering reservoir?',
    ]);
  });

  it('drops "next" on the last step and with no procedure', () => {
    expect(suggestionsFor(coolantStep(4), pack)).not.toContain(ASK_NEXT);
    expect(suggestionsFor(INITIAL_SESSION, pack)).toEqual([
      'Where is the coolant reservoir?',
    ]);
  });

  it('every suggestion gets a real answer', () => {
    const state = coolantStep(1);
    for (const question of suggestionsFor(state, pack)) {
      expect(answerFor(question, state, pack).reply).not.toMatch(
        /^Ask for a part/,
      );
    }
  });
});
