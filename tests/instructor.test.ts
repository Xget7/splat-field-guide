import {
  findPart,
  NoteTopic,
  type Pack,
} from '../apps/field-guide/src/features/pack/pack';
import {
  INITIAL_SESSION,
  SessionEventType,
  startAt,
  type SessionState,
} from '../apps/field-guide/src/features/guide/session';
import { TOUR_ID } from '../apps/field-guide/src/features/guide/tour';
import { bundledPack } from '../apps/field-guide/src/features/pack/bundledPack';
import {
  answerFor,
  asksForSpecification,
  focusPart,
  isQuestion,
  isScripted,
  namedPart,
  NOT_COVERED_REPLY,
} from '../apps/field-guide/src/features/instructor/instructor';

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

const specificationsOf = (partId: string) =>
  part(partId).notes.find(note => note.topic === NoteTopic.specifications)
    ?.text;

describe('specifications', () => {
  it.each([
    ['So what type of oil this gold train carries?', 'valve-cover', 'engine'],
    ['What oil does this car take?', 'valve-cover', 'engine'],
    ['Is 5W30 fine?', 'valve-cover', 'engine'],
    ['When should I change the oil?', 'valve-cover', 'engine'],
    [
      'Which brake fluid should I use?',
      'brake-fluid-reservoir',
      'brake-fluid-reservoir',
    ],
    [
      'How much coolant does it hold?',
      'coolant-reservoir',
      'coolant-reservoir',
    ],
    [
      'And how many liters I should put on the coolant?',
      'coolant-reservoir',
      'coolant-reservoir',
    ],
    [
      'how many liters can have the motor of water in? destiled',
      'coolant-reservoir',
      'coolant-reservoir',
    ],
    ['How much oil does the motor take?', 'valve-cover', 'engine'],
    ['How much water does the battery need?', 'battery', 'battery'],
    ['Which fuse is for the radio?', 'fuse-box', 'fuse-box'],
  ])(
    'answers "%s" with the verified specifications only',
    (question, shown, owner) => {
      expect(isScripted(question, pack)).toBe(true);
      const answer = answerFor(question, coolantStep(1), pack);
      expect(specificationsOf(owner)).toContain(answer.reply);
      expect(answer).toEqual({
        reply: answer.reply,
        caution: '',
        part: shown,
        event: select(shown),
      });
    },
  );

  it.each([
    [
      'What oil does it use?',
      /^The engine oil grade is 5W-40, as the owner's manual states\.$/,
    ],
    ['How much oil does the motor take?', /^The oil capacity\b/],
    [
      'When should I change the oil?',
      /^The oil capacity, oil and filter interval\b/,
    ],
  ])('answers "%s" with only the sentence it asks for', (question, reply) => {
    expect(answerFor(question, INITIAL_SESSION, pack).reply).toMatch(reply);
  });

  it.each([
    'What is the tire pressure?',
    'What is the torque for the spark plugs?',
  ])('declines "%s" instead of guessing', question => {
    expect(asksForSpecification(question)).toBe(true);
    expect(answerFor(question, coolantStep(1), pack)).toEqual({
      reply: NOT_COVERED_REPLY,
      caution: '',
      part: null,
      event: null,
    });
  });

  it.each([
    'What does the fuse box do?',
    'Where do I put the oil?',
    'What is the oil filler cap for?',
    'How does the battery work?',
    'Tell me about the engine',
  ])('still answers "%s"', question => {
    expect(asksForSpecification(question)).toBe(false);
  });
});

describe('scripted questions', () => {
  it.each(['next', 'check the coolant', 'Where is the battery?'])(
    'answers "%s" without the model',
    question => {
      expect(isScripted(question, pack)).toBe(true);
    },
  );

  it.each([
    'What does the fuse box do?',
    'Why does my engine run badly?',
    'How does the coolant tank work?',
    'How do I check the coolant?',
    'Where is the coolant reservoir and how do I check it?',
  ])('leaves "%s" to the model', question => {
    expect(isScripted(question, pack)).toBe(false);
  });

  it('names the part a question names', () => {
    expect(namedPart('Tell me about the engine', pack)).toBe('engine');
    expect(namedPart('Where do I put the oil?', pack)).toBe('valve-cover');
    expect(namedPart('Why does it rattle?', pack)).toBeNull();
  });
});

describe('questions worth a model', () => {
  it.each(['What does the fuse box do?', 'Why?', 'battery'])(
    'sends "%s"',
    question => expect(isQuestion(question, pack)).toBe(true),
  );

  it.each(['.', 'Thanks', 'um yeah'])('keeps "%s" from the model', question =>
    expect(isQuestion(question, pack)).toBe(false),
  );
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
    ['check the brake fluid', 'check-brake-fluid'],
    ['walk me through the coolant check', 'check-coolant'],
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

  it('tells a procedure asked about without leaving the step on screen', () => {
    const question = 'How do I check the coolant level?';
    const steps = pack.procedures.find(p => p.id === 'check-coolant')?.steps;
    expect(isScripted(question, pack)).toBe(false);
    expect(answerFor(question, coolantStep(2), pack)).toMatchObject({
      reply: steps?.map(step => step.text).join(' '),
      event: null,
    });
  });

  it('keeps the place when asked for the procedure already running', () => {
    const step = pack.procedures.find(p => p.id === 'check-coolant')?.steps[2];
    expect(answerFor('check the coolant level', coolantStep(2), pack)).toEqual({
      reply: step?.text,
      caution: step?.caution,
      part: step?.parts[0] ?? null,
      event: { type: SessionEventType.repeat },
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
