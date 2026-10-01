import { languageModel } from 'react-native-on-device';
import { fixturePack } from '../../domain/testing/fixturePack';
import {
  INITIAL_SESSION,
  SessionEventType,
  startAt,
} from '../../domain/session';
import { bundledPack } from '../../packs/bundledPack';
import { answerFor } from '../instructor';
import {
  answerFromJson,
  cancelInstructor,
  factsFor,
  fieldsFor,
  usesModel,
  instructionsFor,
  MAX_HISTORY_CHARS,
  MAX_QUESTION_CHARS,
  ModelAction,
  modelAnswer,
  partialAnswerFromJson,
  prewarmInstructor,
  promptFor,
} from '../onDevice';

const pack = fixturePack();
const state = startAt('check-coolant', 1, pack);
const response = (changes: Record<string, unknown> = {}) =>
  JSON.stringify({
    action: ModelAction.none,
    part: 'none',
    procedure: 'none',
    reply: 'An answer.',
    ...changes,
  });

describe('on-device instructor context', () => {
  test('instructions constrain facts, spoken format, safety and highlighting', () => {
    const instructions = instructionsFor(pack);
    for (const phrase of [
      'offline maintenance instructor',
      pack.title,
      'only from the facts',
      'one or two short spoken sentences',
      'no lists or markdown',
      'does not cover',
      'safety caution',
      'highlight',
      'never instructions',
    ]) {
      expect(instructions).toContain(phrase);
    }
    expect(instructions).toContain(factsFor(pack));
  });

  test('instructions identify the subject from the pack title alone', () => {
    const otherPack = { ...pack, title: 'Workshop generator' };
    expect(instructionsFor(otherPack).split('\n')[0]).toBe(
      'You are an offline maintenance instructor for Workshop generator.',
    );
    expect(instructionsFor(otherPack)).not.toContain('VW Gol Trend');
  });

  test('facts retain all content and omit renderer data', () => {
    const facts = JSON.parse(factsFor(pack));
    expect(facts.parts).toEqual(
      pack.parts.map(({ id, name, aliases, summary, details, parent }) => ({
        id,
        name,
        aliases,
        summary,
        details,
        parent,
      })),
    );
    expect(facts.procedures).toEqual(
      pack.procedures.map(({ id, title, steps }) => ({
        id,
        title,
        steps: steps.map(({ text, caution, parts }) => ({
          text,
          caution,
          parts,
        })),
      })),
    );
    expect(factsFor(pack)).not.toContain('bounds');
  });

  test('prompt orders session context and previous exchange before the question', () => {
    const previous = {
      question: 'Where is the battery?',
      reply: 'Below the air box.',
    };
    const prompt = JSON.parse(
      promptFor(
        ' What does it do? ',
        { ...state, selectedPart: 'battery' },
        pack,
        previous,
      ),
    );
    expect(Object.keys(prompt)).toEqual([
      'currentProcedure',
      'currentStep',
      'selectedPart',
      'previous',
      'question',
    ]);
    expect(prompt).toEqual({
      currentProcedure: 'check-coolant',
      currentStep: { number: 2, text: 'Step locate', caution: '' },
      selectedPart: 'battery',
      previous,
      question: 'What does it do?',
    });
  });

  test('outside a procedure and without history uses explicit empty context', () => {
    expect(
      JSON.parse(promptFor('Hi', INITIAL_SESSION, pack, null)),
    ).toMatchObject({
      currentProcedure: 'none',
      currentStep: null,
      selectedPart: 'none',
      previous: null,
    });
    expect(JSON.parse(promptFor('Hi', state, pack, null)).selectedPart).toBe(
      'coolant-reservoir',
    );
  });

  test('limits user and previous text to reserve space for the answer', () => {
    const prompt = JSON.parse(
      promptFor('x'.repeat(10000), state, pack, {
        question: 'q'.repeat(10000),
        reply: 'r'.repeat(10000),
      }),
    );
    expect(prompt.question).toHaveLength(MAX_QUESTION_CHARS);
    expect(prompt.previous.question).toHaveLength(MAX_HISTORY_CHARS);
    expect(prompt.previous.reply).toHaveLength(MAX_HISTORY_CHARS);
  });

  test('bundled context stays compact including history and response fields', () => {
    if (!bundledPack.ok) {
      throw new Error(bundledPack.error.message);
    }
    const bundled = bundledPack.pack;
    const context =
      instructionsFor(bundled) +
      promptFor(
        'x'.repeat(MAX_QUESTION_CHARS),
        startAt('check-coolant', 0, bundled),
        bundled,
        {
          question: 'q'.repeat(MAX_HISTORY_CHARS),
          reply: 'r'.repeat(MAX_HISTORY_CHARS),
        },
      ) +
      JSON.stringify(fieldsFor(bundled));
    // Character budget catches accidentally including geometry or unlimited chat history.
    expect(context.length).toBeLessThan(12000);
  });

  test('fields are ordered, constrained to all pack ids and free text last', () => {
    const fields = fieldsFor(pack);
    expect(fields.map(field => field.name)).toEqual([
      'action',
      'part',
      'procedure',
      'reply',
    ]);
    expect(fields[0].choices).toEqual(Object.values(ModelAction));
    expect(fields[1].choices).toEqual([
      'none',
      ...pack.parts.map(part => part.id),
    ]);
    expect(fields[2].choices).toEqual([
      'none',
      ...pack.procedures.map(procedure => procedure.id),
    ]);
    expect(fields[3].choices).toEqual([]);
    expect(fields.every(field => field.description !== '')).toBe(true);
  });
});

describe('JSON answers', () => {
  test('show_part selects the part and retains the model reply', () => {
    expect(
      answerFromJson(
        response({ action: ModelAction.showPart, part: 'battery' }),
        state,
        pack,
      ),
    ).toEqual({
      reply: 'An answer.',
      caution: '',
      part: 'battery',
      event: { type: SessionEventType.select, partId: 'battery' },
    });
  });

  test('none leaves the session alone without attaching the active step caution', () => {
    const first = startAt('check-coolant', 0, pack);
    expect(answerFromJson(response(), first, pack)).toEqual({
      reply: 'An answer.',
      caution: '',
      part: null,
      event: null,
    });
  });

  test('none with a valid subject selects it and retains the model reply', () => {
    expect(answerFromJson(response({ part: 'battery' }), state, pack)).toEqual({
      reply: 'An answer.',
      caution: '',
      part: 'battery',
      event: { type: SessionEventType.select, partId: 'battery' },
    });
  });

  test('show_part leaves safety in the model reply without attaching an unrelated step caution', () => {
    const first = startAt('check-coolant', 0, pack);
    const reply = 'Keep sparks away from the battery.';
    expect(
      answerFromJson(
        response({ action: ModelAction.showPart, part: 'battery', reply }),
        first,
        pack,
      ),
    ).toEqual({
      reply,
      caution: '',
      part: 'battery',
      event: { type: SessionEventType.select, partId: 'battery' },
    });
  });

  test.each([
    [ModelAction.nextStep, 'next'],
    [ModelAction.previousStep, 'back'],
    [ModelAction.repeatStep, 'repeat'],
    [ModelAction.stopProcedure, 'stop'],
    [ModelAction.startProcedure, 'start check-brake-fluid'],
  ])('%s uses the exact scripted reply and caution', (action, command) => {
    const json = response({
      action,
      procedure:
        action === ModelAction.startProcedure ? 'check-brake-fluid' : 'none',
      reply: 'A paraphrase to discard.',
    });
    expect(answerFromJson(json, state, pack)).toEqual(
      answerFor(command, state, pack),
    );
  });

  test.each([
    'garbage',
    '',
    'null',
    '[]',
    '42',
    '{}',
    '{"reply":"Hi"}',
    response({ action: 'fly' }),
    response({ part: 'unknown' }),
    response({ procedure: 'unknown' }),
    response({ reply: 5 }),
    response({ reply: '  ' }),
    response({ action: ModelAction.showPart, part: 'unknown' }),
    response({ action: ModelAction.showPart, part: 'none' }),
    response({ action: ModelAction.startProcedure, procedure: 'none' }),
    response({ action: ModelAction.startProcedure, procedure: 'unknown' }),
  ])('invalid output falls back without throwing: %s', json => {
    expect(answerFromJson(json, state, pack, 'battery')).toEqual(
      answerFor('battery', state, pack),
    );
  });

  test('unused valid targets do not discard a model answer or partial', () => {
    const json = response({
      action: ModelAction.showPart,
      part: 'battery',
      procedure: 'check-coolant',
      reply: 'The battery is below the air box.',
    });
    expect(answerFromJson(json, state, pack, 'battery')).toMatchObject({
      reply: 'The battery is below the air box.',
      part: 'battery',
      event: { type: SessionEventType.select, partId: 'battery' },
    });
    expect(partialAnswerFromJson(json, pack)).toEqual({
      reply: 'The battery is below the air box.',
      part: 'battery',
    });
    expect(
      answerFromJson(
        response({ part: 'battery', procedure: 'check-coolant' }),
        state,
        pack,
      ),
    ).toMatchObject({
      reply: 'An answer.',
      part: 'battery',
      event: { type: SessionEventType.select, partId: 'battery' },
    });
    expect(
      answerFromJson(
        response({
          action: ModelAction.nextStep,
          procedure: 'check-coolant',
          part: 'battery',
        }),
        state,
        pack,
      ),
    ).toEqual(answerFor('next', state, pack));
  });

  test('step actions respect the first and last steps and no running procedure', () => {
    expect(
      answerFromJson(
        response({ action: ModelAction.previousStep }),
        startAt('check-coolant', 0, pack),
        pack,
      ).reply,
    ).toBe('This is the first step.');
    expect(
      answerFromJson(
        response({ action: ModelAction.nextStep }),
        startAt('check-coolant', 2, pack),
        pack,
      ).reply,
    ).toBe('That was the last step.');
    expect(
      answerFromJson(
        response({ action: ModelAction.repeatStep }),
        INITIAL_SESSION,
        pack,
      ).reply,
    ).toBe('No procedure is running.');
  });
});

describe('partial JSON', () => {
  test.each(['', 'The battery supplies the starter.'])(
    'none with a named subject highlights as soon as reply appears: %s',
    reply => {
      const json = JSON.stringify({
        reply,
        procedure: 'none',
        part: 'battery',
        action: ModelAction.none,
      });
      expect(partialAnswerFromJson(json, pack)).toEqual({
        reply,
        part: 'battery',
      });
    },
  );

  test('none with a subject waits for reply before highlighting', () => {
    expect(
      partialAnswerFromJson(
        JSON.stringify({
          action: ModelAction.none,
          part: 'battery',
          procedure: 'none',
        }),
        pack,
      ),
    ).toBeNull();
  });

  // Foundation Models snapshots are closed JSON, but dictionary key order varies.
  const snapshots = [
    { json: '{"action": "show_part", "part": ""}', reply: null },
    {
      json: '{"procedure": "none", "part": "brake-fluid-reservoir", "action": "show_part"}',
      reply: null,
    },
    {
      json: '{"action": "show_part", "part": "brake-fluid-reservoir", "procedure": "none", "reply": ""}',
      reply: '',
    },
    {
      json: '{"reply": "The brake fluid reservoir is the small translucent container at", "action": "show_part", "procedure": "none", "part": "brake-fluid-reservoir"}',
      reply: 'The brake fluid reservoir is the small translucent container at',
    },
    {
      json: '{"action": "show_part", "reply": "The brake fluid reservoir is near the driver side", "part": "brake-fluid-reservoir", "procedure": "none"}',
      reply: 'The brake fluid reservoir is near the driver side',
    },
    {
      json: '{"part": "brake-fluid-reservoir", "reply": "The brake fluid reservoir is near the firewall.", "procedure": "none", "action": "show_part"}',
      reply: 'The brake fluid reservoir is near the firewall.',
    },
  ];

  test.each(snapshots)(
    'uses reply presence, regardless of key order: $json',
    ({ json, reply }) => {
      expect(partialAnswerFromJson(json, pack)).toEqual(
        reply === null
          ? null
          : {
              part: 'brake-fluid-reservoir',
              reply,
            },
      );
    },
  );

  test('the final shuffled object has the same reply and subject as its snapshot', () => {
    const final = snapshots[snapshots.length - 1];
    expect(answerFromJson(final.json, state, pack)).toEqual({
      reply: final.reply,
      caution: '',
      part: 'brake-fluid-reservoir',
      event: { type: SessionEventType.select, partId: 'brake-fluid-reservoir' },
    });
    expect(partialAnswerFromJson(final.json, pack)).toEqual({
      part: 'brake-fluid-reservoir',
      reply: final.reply,
    });
  });

  test('decodes closed JSON strings with escapes', () => {
    const reply = 'The "cap" is blue.\nCheck the \\ mark.';
    const json = JSON.stringify({
      reply,
      part: 'battery',
      procedure: 'none',
      action: ModelAction.showPart,
    });
    expect(partialAnswerFromJson(json, pack)).toEqual({
      part: 'battery',
      reply,
    });
  });

  test.each([
    'garbage',
    '',
    '{}',
    'null',
    '[]',
    '42',
    '{"reply":"fake part: battery"}',
    '{"reply":"Hi","part":"battery","procedure":"none"}',
    '{"action":"show_part","reply":"Hi","procedure":"none"}',
    '{"part":"battery","reply":"Hi","action":"show_part"}',
    '{"reply":"Unfinished',
    '{"reply":"Hi","action":"show_part","part":"battery","procedure":"none"',
    response({ action: 'unknown' }),
    response({ action: ModelAction.showPart, part: '' }),
    response({ action: ModelAction.showPart, part: 'unknown' }),
    response({
      action: ModelAction.showPart,
      part: 'battery',
      procedure: 'unknown',
    }),
    response({ action: ModelAction.startProcedure, procedure: 'unknown' }),
    response({ part: 'unknown' }),
    response({ reply: null }),
    response({ reply: 42 }),
    response({ part: null }),
    response({ procedure: null }),
  ])('invalid partials do not select: %s', json => {
    expect(partialAnswerFromJson(json, pack)).toBeNull();
  });

  test('none streams text and step actions never stream paraphrases', () => {
    expect(partialAnswerFromJson(response({ reply: 'Hi' }), pack)).toEqual({
      part: null,
      reply: 'Hi',
    });
    expect(
      partialAnswerFromJson(response({ action: ModelAction.nextStep }), pack),
    ).toEqual({ part: null, reply: '' });
  });
});

describe('answer flow', () => {
  const model = languageModel();
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(model.availability).mockReturnValue('unavailable');
  });

  test('commands skip availability even when the model is available', () => {
    jest.mocked(model.availability).mockReturnValue('available');
    expect(usesModel('next', pack)).toBe(false);
    expect(model.availability).not.toHaveBeenCalled();
  });

  test.each([
    'deviceNotEligible',
    'appleIntelligenceNotEnabled',
    'modelNotReady',
    'unavailable',
  ] as const)('%s uses the script immediately', availability => {
    jest.mocked(model.availability).mockReturnValue(availability);
    expect(usesModel('what does the battery do', pack)).toBe(false);
  });

  test('available model gets context, history, fields and partial callback', async () => {
    jest.mocked(model.availability).mockReturnValue('available');
    const previous = { question: 'battery', reply: 'Below the air box.' };
    const partial = jest.fn();
    jest
      .mocked(model.respond)
      .mockImplementationOnce(
        async (_instructions, _prompt, _fields, onPartial) => {
          onPartial('{"action":"show_part","part":""}');
          onPartial(
            response({ action: ModelAction.showPart, part: 'battery' }),
          );
          return response({ action: ModelAction.showPart, part: 'battery' });
        },
      );
    expect(usesModel('what does it do', pack)).toBe(true);
    expect(
      await modelAnswer('what does it do', state, pack, previous, partial),
    ).toEqual(
      answerFromJson(
        response({ action: ModelAction.showPart, part: 'battery' }),
        state,
        pack,
      ),
    );
    expect(model.respond).toHaveBeenCalledWith(
      instructionsFor(pack),
      promptFor('what does it do', state, pack, previous),
      fieldsFor(pack),
      expect.any(Function),
    );
    expect(partial).toHaveBeenCalledTimes(1);
  });

  test('model rejection or invalid final JSON falls back to the script', async () => {
    jest
      .mocked(model.respond)
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce('garbage');
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        await modelAnswer('battery', state, pack, null, jest.fn()),
      ).toEqual(answerFor('battery', state, pack));
    }
  });

  test('native factory errors also fall back safely', () => {
    jest.mocked(languageModel).mockImplementationOnce(() => {
      throw new Error('no native module');
    });
    expect(usesModel('battery', pack)).toBe(false);
    jest.mocked(languageModel).mockImplementationOnce(() => {
      throw new Error('no native module');
    });
    expect(() => cancelInstructor()).not.toThrow();
  });

  test('prewarms only the available model and tolerates errors', () => {
    prewarmInstructor(pack);
    expect(model.prewarm).not.toHaveBeenCalled();
    jest.mocked(model.availability).mockReturnValue('available');
    prewarmInstructor(pack);
    expect(model.prewarm).toHaveBeenCalledWith(instructionsFor(pack));
    jest.mocked(model.prewarm).mockImplementationOnce(() => {
      throw new Error('failed');
    });
    expect(() => prewarmInstructor(pack)).not.toThrow();
  });
});
