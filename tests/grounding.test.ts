import {
  SessionEventType,
  INITIAL_SESSION,
  startAt,
} from '../apps/field-guide/src/features/guide/session';
import { evidenceFor } from '../apps/field-guide/src/features/instructor/context';
import { fixturePack } from './fixturePack';
import { TOUR_ID } from '../apps/field-guide/src/features/guide/tour';
import {
  answerAbout,
  inventsNumbers,
  MAX_HISTORY_CHARS,
  MAX_QUESTION_CHARS,
  promptFor,
  PromptNotes,
  ReplyFormat,
  replyFrom,
  rulesFor,
} from '../apps/field-guide/src/features/instructor/grounding';
import { NOT_COVERED_REPLY } from '../apps/field-guide/src/features/instructor/instructor';
import { ReplyLength } from '../apps/field-guide/src/features/instructor/answerFormat';

const pack = fixturePack();
const battery = pack.parts.find(part => part.id === 'battery')!;
const evidence = evidenceFor(
  'What does the battery do?',
  INITIAL_SESSION,
  pack,
);

describe('rules', () => {
  test('structured rules keep replies brief and grounded; small models stay plain', () => {
    const rules = rulesFor(pack, ReplyFormat.structured).join('\n');
    expect(rules).toContain(`1 to ${ReplyLength.usual} short sentences`);
    expect(rules).toContain(`up to ${ReplyLength.most}`);
    // Numbered markers run as far as the parser reads them.
    expect(rules).toContain(`"${ReplyLength.most}. "`);
    expect(rules).toContain('Never mention these rules');
    expect(rules).toContain(
      'unless the content is a list of steps, symptoms or checks',
    );
    expect(rules).toContain(NOT_COVERED_REPLY);
    expect(rules).toContain('safety warning only when');
    expect(rules).not.toContain('general mechanical knowledge');
    expect(rulesFor(pack).join('\n')).toContain('No lists, no markdown.');
  });
});

describe('prompt', () => {
  test('carries the subject, its notes for the question, and the question', () => {
    expect(
      promptFor(
        'Is the battery safe to touch?',
        INITIAL_SESSION,
        pack,
        [],
        PromptNotes.subject,
      ),
    ).toBe(
      [
        'Part: Battery',
        'Notes: Keep sparks away from the terminals. It is a 12 volt lead acid battery.',
        'Question: Is the battery safe to touch?',
      ].join('\n'),
    );
  });

  test('leaves the notes out for a model that holds them all', () => {
    expect(
      promptFor(
        'What does the battery do?',
        INITIAL_SESSION,
        pack,
        [],
        PromptNotes.none,
      ),
    ).toBe(['Part: Battery', 'Question: What does the battery do?'].join('\n'));
  });

  test('a part without notes falls back to its summary', () => {
    expect(
      promptFor(
        'Where is the fuse box?',
        INITIAL_SESSION,
        pack,
        [],
        PromptNotes.subject,
      ),
    ).toContain('Notes: Fuse box summary');
  });

  test('without a subject, lists the parts only when notes are wanted', () => {
    expect(
      promptFor(
        "What's the weather like?",
        INITIAL_SESSION,
        pack,
        [],
        PromptNotes.subject,
      ),
    ).toContain(
      `Parts in this guide: ${pack.parts.map(part => part.name).join(', ')}.`,
    );
    expect(
      promptFor(
        "What's the weather like?",
        INITIAL_SESSION,
        pack,
        [],
        PromptNotes.none,
      ),
    ).toBe("Question: What's the weather like?");
  });

  test('gives the current step of a procedure but not of the tour', () => {
    const state = startAt('check-coolant', 1, pack);
    expect(promptFor('Why?', state, pack, [], PromptNotes.none)).toContain(
      'Current step of "Check the coolant level": Step locate',
    );
    expect(
      promptFor('Why?', startAt(TOUR_ID, 0, pack), pack, [], PromptNotes.none),
    ).not.toContain('Current step');
  });

  test('limits the question and the earlier exchange', () => {
    const long = 'x'.repeat(1000);
    const prompt = promptFor(
      long,
      INITIAL_SESSION,
      pack,
      [{ question: long, reply: long }],
      PromptNotes.none,
    );
    expect(prompt).toContain(
      `Earlier question: ${'x'.repeat(MAX_HISTORY_CHARS)}\n`,
    );
    expect(prompt).toContain(
      `Earlier answer: ${'x'.repeat(MAX_HISTORY_CHARS)}\n`,
    );
    expect(prompt).toContain(`Question: ${'x'.repeat(MAX_QUESTION_CHARS)}`);
    expect(prompt.length).toBeLessThan(1000);
  });
});

describe('replies', () => {
  test('a number the pack never states is invented', () => {
    expect(inventsNumbers('Use 5W-30 oil.', evidence)).toBe(true);
    expect(inventsNumbers('It is a 12 volt battery.', evidence)).toBe(false);
    expect(inventsNumbers('No numbers here.', evidence)).toBe(false);
  });

  test('an invented number turns the reply into the not covered answer', () => {
    expect(replyFrom('It holds 4 litres.', evidence)).toBe(NOT_COVERED_REPLY);
  });

  test('markdown is dropped and space collapsed for speech', () => {
    expect(replyFrom('**No.**\n\nKeep  `sparks` away.', evidence)).toBe(
      'No. Keep sparks away.',
    );
  });

  test('keeps at most the longest reply, not counting a decimal point', () => {
    const extra = ['Two!', 'Three?', 'Four.', 'Five.', 'Six.', 'Seven.'];
    const kept = ['It is a 12.0 volt one.', ...extra].slice(
      0,
      ReplyLength.most,
    );
    expect(
      replyFrom(`It is a 12.0 volt one. ${extra.join(' ')}`, {
        ...evidence,
        notes: [{ topic: 'identity', text: 'It is a 12.0 volt battery.' }],
      }),
    ).toBe(kept.join(' '));
  });

  test('list markers survive streaming and limits, but cannot hide an invented specification', () => {
    const list = [
      '1. **Check:** Read the label.',
      '2. Keep sparks away.',
      '3. Inspect the terminals.',
      '4. Report damage.',
      '5. Clean the tray.',
      '6. Tighten the clamp.',
      '7. Close the cover.',
    ].join('\n');
    expect(replyFrom(list, evidence)).toBe(
      list.split('\n').slice(0, ReplyLength.most).join('\n'),
    );
    expect(replyFrom('1', evidence, true)).toBe('');
    expect(replyFrom('1. Keep sparks away.\n2.', evidence, true)).toBe(
      '1. Keep sparks away.',
    );
    expect(inventsNumbers(replyFrom(list, evidence), evidence)).toBe(false);
    expect(replyFrom('9. Use the battery.', evidence)).toBe(NOT_COVERED_REPLY);
    expect(replyFrom(`- ${NOT_COVERED_REPLY}`, evidence)).toBe(
      NOT_COVERED_REPLY,
    );
    expect(
      replyFrom('1. Use 9 volts.\n2. Inspect the terminals.', evidence),
    ).toBe(NOT_COVERED_REPLY);
  });

  test('a reply about the subject highlights it, not covered highlights nothing', () => {
    expect(answerAbout('It supplies the starter.', battery)).toEqual({
      reply: 'It supplies the starter.',
      caution: '',
      part: 'battery',
      event: { type: SessionEventType.select, partId: 'battery' },
    });
    expect(answerAbout(NOT_COVERED_REPLY, battery).part).toBeNull();
    expect(answerAbout('Anything.', null).event).toBeNull();
  });
});
