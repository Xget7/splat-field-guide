import { fakePlatform } from '@tests/platform';
import { createTurnRunner } from '../domain/turn/turnRunner';
import { createExchangeIds } from '../domain/turn/exchange';
import { INITIAL_SESSION, startAt } from '../../guide';
import { evidenceFor } from '../domain/context';
import { fixturePack } from '@tests/fixturePack';
import {
  createDeviceAnswerer,
  onDeviceInstructions,
} from '../data/answerers/deviceAnswerer';

const pack = fixturePack();
const fake = fakePlatform();
const model = fake.model;
const languageModel = jest.fn(fake.platform.languageModel);
const deviceAnswerer = createDeviceAnswerer(languageModel);
const noNativeModule = () => {
  throw new Error('no native module');
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(model.availability).mockReturnValue('unavailable');
});

test.each([
  'deviceNotEligible',
  'appleIntelligenceNotEnabled',
  'modelNotReady',
  'unavailable',
] as const)('is not ready when the model is %s', availability => {
  jest.mocked(model.availability).mockReturnValue(availability);
  expect(deviceAnswerer.isReady()).toBe(false);
});

test('is ready when available, and not when the native module is missing', () => {
  jest.mocked(model.availability).mockReturnValue('available');
  expect(deviceAnswerer.isReady()).toBe(true);
  jest.mocked(languageModel).mockImplementationOnce(noNativeModule);
  expect(deviceAnswerer.isReady()).toBe(false);
});

test('prewarms only an available model and tolerates failures', () => {
  deviceAnswerer.prewarm(pack);
  expect(model.prewarm).not.toHaveBeenCalled();
  jest.mocked(model.availability).mockReturnValue('available');
  deviceAnswerer.prewarm(pack);
  expect(model.prewarm).toHaveBeenCalledWith(onDeviceInstructions(pack));
  jest.mocked(model.prewarm).mockImplementationOnce(noNativeModule);
  expect(() => deviceAnswerer.prewarm(pack)).not.toThrow();
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
    evidence: evidenceFor('What does the battery do?', INITIAL_SESSION, pack),
    state: INITIAL_SESSION,
    pack,
    history: [],
  };
  await expect(deviceAnswerer.respond(request, onText)).resolves.toBe(
    'It supplies the starter.',
  );
  const [instructions, prompt] = jest.mocked(model.respond).mock.calls[0];
  expect(instructions).toContain('DO NOT state a number');
  expect(instructions).toContain('Fixture engine bay');
  expect(prompt).toContain('Part: Battery');
  expect(prompt).toContain('It supplies the starter motor.');
  expect(prompt).toContain('Keep sparks away from the terminals.');
  expect(prompt).toContain('Question: What does the battery do?');
  expect(onText).toHaveBeenCalledWith('It');
});

test('cancel works without the native module', () => {
  deviceAnswerer.cancel();
  expect(model.cancel).toHaveBeenCalled();
  jest.mocked(languageModel).mockImplementationOnce(noNativeModule);
  expect(() => deviceAnswerer.cancel()).not.toThrow();
});

test('explaining another procedure supplies its authored steps and cautions without starting it', async () => {
  jest.mocked(model.availability).mockReturnValue('available');
  jest
    .mocked(model.respond)
    .mockResolvedValueOnce('Read the coolant level with the engine cold.');
  const changed = jest.fn();
  await createTurnRunner([deviceAnswerer], createExchangeIds()).ask(
    {
      question: 'How do I check the coolant level?',
      state: startAt('check-brake-fluid', 1, pack),
      pack,
      history: [],
    },
    changed,
  );
  const prompt = jest.mocked(model.respond).mock.calls[0][1];
  expect(prompt).toContain('Step engine-cold');
  expect(prompt).toContain('Step locate');
  expect(prompt).toContain('Step read-level');
  expect(prompt).toContain('Only with the engine cold.');
  expect(changed.mock.calls.at(-1)?.[0].answer.event?.type).not.toBe('start');
});

test('oversized procedure evidence falls back rather than dropping its caution', async () => {
  jest.mocked(model.availability).mockReturnValue('available');
  const large = {
    ...pack,
    procedures: pack.procedures.map(procedure =>
      procedure.id === 'check-coolant'
        ? {
            ...procedure,
            steps: procedure.steps.map((step, index) =>
              index === 0
                ? { ...step, text: 'instruction '.repeat(600) }
                : step,
            ),
          }
        : procedure,
    ),
  };
  const changed = jest.fn();
  await createTurnRunner([deviceAnswerer], createExchangeIds()).ask(
    {
      question: 'How do I check the coolant level?',
      state: INITIAL_SESSION,
      pack: large,
      history: [],
    },
    changed,
  );
  expect(model.respond).not.toHaveBeenCalled();
  expect(changed.mock.calls.at(-1)?.[0].answer.caution).toContain(
    'Only with the engine cold.',
  );
});
