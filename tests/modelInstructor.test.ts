import { INITIAL_SESSION } from '../apps/field-guide/src/features/guide/session';
import { fixturePack } from './fixturePack';
import { answerAbout } from '../apps/field-guide/src/features/instructor/grounding';
import {
  answerFor,
  NOT_COVERED_REPLY,
} from '../apps/field-guide/src/features/instructor/instructor';
import { TurnEventType } from '../apps/field-guide/src/features/instructor/turn';
import { createModelInstructor } from '../apps/field-guide/src/features/instructor/models/modelInstructor';
import { type InstructorModel } from '../apps/field-guide/src/features/instructor/models/InstructorModel';

let instructor = createModelInstructor([]);
const pack = fixturePack();
const battery = pack.parts.find(part => part.id === 'battery')!;
const QUESTION = 'What does the battery do?';

const fakeModel = (
  respond: InstructorModel['respond'],
  ready = true,
): InstructorModel => ({
  isReady: jest.fn(() => ready),
  prewarm: jest.fn(),
  respond: jest.fn(respond),
  cancel: jest.fn(),
});
const replies = (text: string) => async () => text;
const fails = async (): Promise<string> => {
  throw new Error('down');
};
async function ask(
  onPartial = jest.fn(),
  owner = instructor,
  question = QUESTION,
) {
  let answer;
  await owner.ask(
    { question, state: INITIAL_SESSION, pack, history: [] },
    event => {
      if (event.type === TurnEventType.partial && event.exchange.reply !== '') {
        onPartial({ reply: event.exchange.reply, part: event.exchange.part });
      }
      if (event.type === TurnEventType.answer) {
        answer = event.answer;
      }
    },
  );
  return answer!;
}

test('the cloud answers first when it can', async () => {
  const cloud = fakeModel(replies('It starts the engine.'));
  const local = fakeModel(replies('Local.'));
  instructor = createModelInstructor([cloud, local]);
  expect(await ask()).toEqual(answerAbout('It starts the engine.', battery));
  expect(local.respond).not.toHaveBeenCalled();
  expect(cloud.respond).toHaveBeenCalledWith(
    expect.objectContaining({
      question: QUESTION,
      state: INITIAL_SESSION,
      pack,
      history: [],
    }),
    expect.any(Function),
  );
});

test('a failed or empty model hands the same resolved evidence to the next one', async () => {
  for (const first of [fails, replies('  ')]) {
    const preferred = fakeModel(first);
    const fallback = fakeModel(replies('It supplies the starter.'));
    instructor = createModelInstructor([preferred, fallback]);
    expect(await ask()).toEqual(
      answerAbout('It supplies the starter.', battery),
    );
    const evidence = jest.mocked(preferred.respond).mock.calls[0][0].evidence;
    expect(jest.mocked(fallback.respond).mock.calls[0][0].evidence).toBe(
      evidence,
    );
    expect(evidence.subject?.id).toBe('battery');
    expect(evidence.safety?.text).toBe('Keep sparks away from the terminals.');
  }
});

test('a model that is not ready is skipped', async () => {
  const cloud = fakeModel(replies('Cloud.'), false);
  instructor = createModelInstructor([cloud, fakeModel(replies('Local.'))]);
  expect((await ask()).reply).toBe('Local.');
  expect(cloud.respond).not.toHaveBeenCalled();
});

test('the script answers when every model fails', async () => {
  instructor = createModelInstructor([fakeModel(fails), fakeModel(fails)]);
  expect(await ask()).toEqual(answerFor(QUESTION, INITIAL_SESSION, pack));
});

test('partials are shaped and carry the subject the answer will highlight', async () => {
  const onPartial = jest.fn();
  instructor = createModelInstructor([
    fakeModel(async (_request, onText) => {
      onText(' ');
      onText('It **supplies**');
      onText('It holds 9 litres');
      return 'It supplies the starter.';
    }),
  ]);
  await ask(onPartial);
  expect(onPartial.mock.calls).toEqual([
    [{ reply: 'It supplies', part: 'battery' }],
    [{ reply: NOT_COVERED_REPLY, part: null }],
  ]);
});

test('a guessed number in the final text is never shown', async () => {
  instructor = createModelInstructor([fakeModel(replies('Use 5W-30.'))]);
  expect(await ask()).toEqual(answerAbout(NOT_COVERED_REPLY, battery));
});

test('cancel stops the chain and silences late partials', async () => {
  const onPartial = jest.fn();
  let finish: (text: string) => void = () => {};
  const local = fakeModel(replies('Local.'));
  instructor = createModelInstructor([
    fakeModel((_request, onText) => {
      return new Promise<string>((_resolve, reject) => {
        finish = text => {
          onText(text);
          reject(new Error('cancelled'));
        };
      });
    }),
    local,
  ]);
  const answer = ask(onPartial);
  instructor.cancel();
  finish('Late words.');
  await answer;
  expect(onPartial).not.toHaveBeenCalled();
  expect(local.respond).not.toHaveBeenCalled();
});

test('commands stay synchronous and questions with no ready model use the script', async () => {
  const model = fakeModel(replies('Cloud.'));
  instructor = createModelInstructor([model]);
  const changed = jest.fn();
  const done = instructor.ask(
    { question: 'next', state: INITIAL_SESSION, pack, history: [] },
    changed,
  );
  expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
    type: TurnEventType.answer,
  });
  await done;
  expect(model.respond).not.toHaveBeenCalled();
  instructor = createModelInstructor([fakeModel(replies('Cloud.'), false)]);
  expect(await ask()).toEqual(answerFor(QUESTION, INITIAL_SESSION, pack));
});

test('prewarm reaches only ready models and cancel reaches all', () => {
  const ready = fakeModel(replies(''));
  const idle = fakeModel(replies(''), false);
  instructor = createModelInstructor([ready, idle]);
  instructor.prewarm(pack);
  expect(ready.prewarm).toHaveBeenCalledWith(pack);
  expect(idle.prewarm).not.toHaveBeenCalled();
  instructor.cancel();
  expect(ready.cancel).toHaveBeenCalled();
  expect(idle.cancel).toHaveBeenCalled();
});

test('cancelling one instructor leaves another pending answer active', async () => {
  const onPartial = jest.fn();
  let finish: () => void = () => {};
  const firstModel = fakeModel(replies('First.'));
  const secondModel = fakeModel((_request, onText) => {
    return new Promise<string>(resolve => {
      finish = () => {
        onText('It supplies the starter.');
        resolve('It supplies the starter.');
      };
    });
  });
  const first = createModelInstructor([firstModel]);
  const second = createModelInstructor([secondModel]);
  const pending = ask(onPartial, second);

  first.cancel();
  finish();

  expect(await pending).toEqual(
    answerAbout('It supplies the starter.', battery),
  );
  expect(onPartial).toHaveBeenCalledWith({
    reply: 'It supplies the starter.',
    part: 'battery',
  });
  expect(firstModel.cancel).toHaveBeenCalled();
  expect(secondModel.cancel).not.toHaveBeenCalled();
});

test('a battery voltage does not ground a coolant capacity', async () => {
  instructor = createModelInstructor([
    fakeModel(replies('Coolant capacity is 12 litres.')),
  ]);
  const answer = await ask(
    jest.fn(),
    instructor,
    'Explain the coolant reservoir',
  );
  expect(answer.reply).toBe(NOT_COVERED_REPLY);
  expect(answer.event).toBeNull();
});

test('late words from a failed model cannot replace the fallback model in the same turn', async () => {
  let late!: (text: string) => void;
  let nextText!: (text: string) => void;
  let finish!: (text: string) => void;
  instructor = createModelInstructor([
    fakeModel((_request, onText) => {
      late = onText;
      return Promise.reject(new Error('failed'));
    }),
    fakeModel((_request, onText) => {
      nextText = onText;
      return new Promise<string>(resolve => {
        finish = resolve;
      });
    }),
  ]);
  const changed = jest.fn();
  const pending = instructor.ask(
    { question: QUESTION, state: INITIAL_SESSION, pack, history: [] },
    changed,
  );
  await Promise.resolve();
  nextText('It supplies the starter.');
  const streaming = changed.mock.calls.at(-1)?.[0];
  late('Discarded remote words.');
  expect(changed.mock.calls.at(-1)?.[0]).toBe(streaming);
  finish('It supplies the starter.');
  await pending;
  expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
    type: TurnEventType.answer,
    answer: { reply: 'It supplies the starter.' },
  });
});
