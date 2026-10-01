import { languageModel } from 'react-native-on-device';
import { INITIAL_SESSION } from '../../../../../apps/field-guide/src/domain/session';
import { fixturePack } from '../../../fixtures/fixturePack';
import {
  Grounding,
  promptFor,
  PromptNotes,
  rulesFor,
} from '../../../../../apps/field-guide/src/modules/instructor/domain/grounding';
import {
  onDeviceInstructions,
  onDeviceModel,
} from '../../../../../apps/field-guide/src/modules/instructor/data/onDeviceModel';

const pack = fixturePack();
const model = languageModel();
const noNativeModule = () => {
  throw new Error('no native module');
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(model.availability).mockReturnValue('unavailable');
});

test('instructions are the strict rules, the same for every question', () => {
  expect(onDeviceInstructions(pack)).toBe(
    rulesFor(pack, Grounding.strict).join('\n'),
  );
});

test.each([
  'deviceNotEligible',
  'appleIntelligenceNotEnabled',
  'modelNotReady',
  'unavailable',
] as const)('is not ready when the model is %s', availability => {
  jest.mocked(model.availability).mockReturnValue(availability);
  expect(onDeviceModel.isReady()).toBe(false);
});

test('is ready when available, and not when the native module is missing', () => {
  jest.mocked(model.availability).mockReturnValue('available');
  expect(onDeviceModel.isReady()).toBe(true);
  jest.mocked(languageModel).mockImplementationOnce(noNativeModule);
  expect(onDeviceModel.isReady()).toBe(false);
});

test('prewarms only an available model and tolerates failures', () => {
  onDeviceModel.prewarm(pack);
  expect(model.prewarm).not.toHaveBeenCalled();
  jest.mocked(model.availability).mockReturnValue('available');
  onDeviceModel.prewarm(pack);
  expect(model.prewarm).toHaveBeenCalledWith(onDeviceInstructions(pack));
  jest.mocked(model.prewarm).mockImplementationOnce(noNativeModule);
  expect(() => onDeviceModel.prewarm(pack)).not.toThrow();
});

test('asks with the subject notes and passes the streamed text through', async () => {
  const onText = jest.fn();
  jest
    .mocked(model.respond)
    .mockImplementationOnce(async (_instructions, _prompt, onPartial) => {
      onPartial('It');
      return 'It supplies the starter.';
    });
  const request = {
    question: 'What does the battery do?',
    state: INITIAL_SESSION,
    pack,
    history: [],
  };
  await expect(onDeviceModel.respond(request, onText)).resolves.toBe(
    'It supplies the starter.',
  );
  expect(model.respond).toHaveBeenCalledWith(
    onDeviceInstructions(pack),
    promptFor(request.question, INITIAL_SESSION, pack, [], PromptNotes.subject),
    onText,
  );
  expect(onText).toHaveBeenCalledWith('It');
});

test('cancel works without the native module', () => {
  onDeviceModel.cancel();
  expect(model.cancel).toHaveBeenCalled();
  jest.mocked(languageModel).mockImplementationOnce(noNativeModule);
  expect(() => onDeviceModel.cancel()).not.toThrow();
});
