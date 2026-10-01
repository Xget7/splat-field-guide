import { INITIAL_SESSION } from '../../../../../apps/field-guide/src/domain/session';
import { fixturePack } from '../../../fixtures/fixturePack';
import { answerAbout } from '../../../../../apps/field-guide/src/modules/instructor/domain/grounding';
import {
  answerFor,
  NOT_COVERED_REPLY,
} from '../../../../../apps/field-guide/src/modules/instructor/domain/instructor';
import { createModelInstructor } from '../../../../../apps/field-guide/src/modules/instructor/application/modelInstructor';
import {
  ModelName,
  type InstructorModel,
} from '../../../../../apps/field-guide/src/modules/instructor/domain/InstructorModel';

let instructor = createModelInstructor([]);
const pack = fixturePack();
const battery = pack.parts.find(part => part.id === 'battery')!;
const QUESTION = 'What does the battery do?';

const fakeModel = (
  name: ModelName,
  respond: InstructorModel['respond'],
  ready = true,
): InstructorModel => ({
  name,
  isReady: jest.fn(() => ready),
  prewarm: jest.fn(),
  respond: jest.fn(respond),
  cancel: jest.fn(),
});
const replies = (text: string) => async () => text;
const fails = async (): Promise<string> => {
  throw new Error('down');
};
const ask = (onPartial = jest.fn()) =>
  instructor.modelAnswer(QUESTION, INITIAL_SESSION, pack, [], onPartial);

test('the cloud answers first when it can', async () => {
  const cloud = fakeModel(ModelName.cloud, replies('It starts the engine.'));
  const local = fakeModel(ModelName.onDevice, replies('Local.'));
  instructor = createModelInstructor([cloud, local]);
  expect(await ask()).toEqual(answerAbout('It starts the engine.', battery));
  expect(local.respond).not.toHaveBeenCalled();
  expect(cloud.respond).toHaveBeenCalledWith(
    { question: QUESTION, state: INITIAL_SESSION, pack, history: [] },
    expect.any(Function),
  );
});

test('a failed or empty model hands over to the next one', async () => {
  for (const first of [fails, replies('  ')]) {
    instructor = createModelInstructor([
      fakeModel(ModelName.cloud, first),
      fakeModel(ModelName.onDevice, replies('It supplies the starter.')),
    ]);
    expect(await ask()).toEqual(
      answerAbout('It supplies the starter.', battery),
    );
  }
});

test('a model that is not ready is skipped', async () => {
  const cloud = fakeModel(ModelName.cloud, replies('Cloud.'), false);
  instructor = createModelInstructor([
    cloud,
    fakeModel(ModelName.onDevice, replies('Local.')),
  ]);
  expect((await ask()).reply).toBe('Local.');
  expect(cloud.respond).not.toHaveBeenCalled();
});

test('the script answers when every model fails', async () => {
  instructor = createModelInstructor([
    fakeModel(ModelName.cloud, fails),
    fakeModel(ModelName.onDevice, fails),
  ]);
  expect(await ask()).toEqual(answerFor(QUESTION, INITIAL_SESSION, pack));
});

test('partials are shaped and carry the subject the answer will highlight', async () => {
  const onPartial = jest.fn();
  instructor = createModelInstructor([
    fakeModel(ModelName.cloud, async (_request, onText) => {
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
  instructor = createModelInstructor([
    fakeModel(ModelName.cloud, replies('Use 5W-30.')),
  ]);
  expect(await ask()).toEqual(answerAbout(NOT_COVERED_REPLY, battery));
});

test('cancel stops the chain and silences late partials', async () => {
  const onPartial = jest.fn();
  let finish: (text: string) => void = () => {};
  const local = fakeModel(ModelName.onDevice, replies('Local.'));
  instructor = createModelInstructor([
    fakeModel(ModelName.cloud, (_request, onText) => {
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
  instructor.cancelInstructor();
  finish('Late words.');
  await answer;
  expect(onPartial).not.toHaveBeenCalled();
  expect(local.respond).not.toHaveBeenCalled();
});

test('scripted questions and a moment with no ready model skip the models', () => {
  instructor = createModelInstructor([
    fakeModel(ModelName.cloud, replies('Cloud.')),
  ]);
  expect(instructor.usesModel(QUESTION, pack)).toBe(true);
  expect(instructor.usesModel('next', pack)).toBe(false);
  expect(instructor.usesModel('What oil does it take?', pack)).toBe(false);
  instructor = createModelInstructor([
    fakeModel(ModelName.cloud, replies('Cloud.'), false),
  ]);
  expect(instructor.usesModel(QUESTION, pack)).toBe(false);
});

test('prewarm reaches only ready models and cancel reaches all', () => {
  const ready = fakeModel(ModelName.cloud, replies(''));
  const idle = fakeModel(ModelName.onDevice, replies(''), false);
  instructor = createModelInstructor([ready, idle]);
  instructor.prewarmInstructor(pack);
  expect(ready.prewarm).toHaveBeenCalledWith(pack);
  expect(idle.prewarm).not.toHaveBeenCalled();
  instructor.cancelInstructor();
  expect(ready.cancel).toHaveBeenCalled();
  expect(idle.cancel).toHaveBeenCalled();
});

test('cancelling one instructor leaves another pending answer active', async () => {
  const onPartial = jest.fn();
  let finish: () => void = () => {};
  const firstModel = fakeModel(ModelName.cloud, replies('First.'));
  const secondModel = fakeModel(ModelName.onDevice, (_request, onText) => {
    return new Promise<string>(resolve => {
      finish = () => {
        onText('It supplies the starter.');
        resolve('It supplies the starter.');
      };
    });
  });
  const first = createModelInstructor([firstModel]);
  const second = createModelInstructor([secondModel]);
  const pending = second.modelAnswer(
    QUESTION,
    INITIAL_SESSION,
    pack,
    [],
    onPartial,
  );

  first.cancelInstructor();
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
