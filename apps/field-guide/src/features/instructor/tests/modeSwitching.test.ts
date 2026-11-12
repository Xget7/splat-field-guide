import { fakePlatform } from '@tests/platform';
import {
  createModeSwitching,
  SwitchTiming,
  type ModeSwitchingOptions,
} from '../domain/mode/modeSwitching';
import { ModeAnnouncement, SwitchLabel } from '../domain/mode/modeCopy';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  SwitchPiece,
  VoiceSource,
  type SwitchStep,
} from '../domain/mode/modeTypes';
import { createDeviceAnswerer } from '../data/answerers/deviceAnswerer';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** A switcher over the fake platform whose online pieces succeed unless the test says otherwise. */
function switching(options: Partial<ModeSwitchingOptions> = {}) {
  const fake = fakePlatform();
  const steps: SwitchStep[] = [];
  const modes = createModeSwitching({
    ...fake.platform,
    device: createDeviceAnswerer(fake.platform.languageModel),
    prepareAgent: async () => true,
    probe: async () => 20,
    onStep: step => steps.push(step),
    ...options,
  });
  return { fake, steps, modes };
}

test('all pieces start first and independent failures settle without blocking readiness', async () => {
  const { modes, steps } = switching({
    prepareAgent: async () => {
      throw new Error('voice');
    },
  });
  const done = jest.fn();
  const result = modes.begin(InstructorMode.switchingToOnline).then(value => {
    done();
    return value;
  });
  expect(steps.map(step => step.state)).toEqual(['starting', 'starting']);
  await jest.advanceTimersByTimeAsync(SwitchTiming.MIN_SWITCH_MS - 1);
  expect(done).not.toHaveBeenCalled();
  expect(
    steps
      .slice(2)
      .map(step => step.state)
      .sort(),
  ).toEqual(['fallback', 'ready']);
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({
    mode: InstructorMode.online,
    sources: { voice: VoiceSource.device, answers: AnswerSource.elevenlabs },
  });
  expect(steps[2].switchId).toBe(1);
});

test('a hanging piece falls back at eight seconds and never emits a late ready', async () => {
  let resolve!: (available: boolean) => void;
  const { modes, steps } = switching({
    prepareAgent: () =>
      new Promise(done => {
        resolve = done;
      }),
  });
  const result = modes.begin(InstructorMode.switchingToOnline);
  await jest.advanceTimersByTimeAsync(SwitchTiming.PIECE_TIMEOUT_MS);
  expect(await result).toMatchObject({ mode: InstructorMode.online });
  const voice = () => steps.filter(step => step.piece === SwitchPiece.voice);
  expect(voice().at(-1)).toEqual({
    switchId: 1,
    piece: 'voice',
    state: 'fallback',
    label: SwitchLabel.deviceVoice,
  });
  resolve(true);
  await Promise.resolve();
  expect(voice()).toHaveLength(2);
});

test('an offline switch selects the script when local model files are unavailable', async () => {
  const { modes, steps } = switching();
  const result = modes.begin(InstructorMode.switchingToOffline);
  await jest.advanceTimersByTimeAsync(SwitchTiming.MIN_SWITCH_MS);
  expect(await result).toEqual({
    mode: InstructorMode.offline,
    sources: { voice: VoiceSource.device, answers: AnswerSource.script },
  });
  expect(steps.at(-1)).toMatchObject({
    state: 'fallback',
    piece: 'answers',
    label: SwitchLabel.script,
  });
  expect(
    modes.announcementFor({
      mode: InstructorMode.offline,
      cause: ModeCause.network,
      voice: VoiceSource.device,
      answers: AnswerSource.script,
    })?.reply,
  ).toBe(ModeAnnouncement.script);
});

test('offline readiness reports verified model files without preparing any inference runner', async () => {
  const { modes, steps, fake } = switching();
  fake.model.availability.mockReturnValue('available');
  const result = modes.begin(InstructorMode.switchingToOffline);
  await jest.advanceTimersByTimeAsync(SwitchTiming.MIN_SWITCH_MS);
  await result;
  expect(steps.filter(step => step.piece === SwitchPiece.answers)).toEqual([
    expect.objectContaining({
      state: 'starting',
      label: SwitchLabel.deviceModel,
    }),
    expect.objectContaining({ state: 'ready', label: SwitchLabel.deviceModel }),
  ]);
  expect(
    steps.some(
      step =>
        step.piece === SwitchPiece.voice ||
        step.piece === SwitchPiece.listening,
    ),
  ).toBe(false);
  expect(fake.output.prepare).not.toHaveBeenCalled();
  expect(fake.input.prepare).not.toHaveBeenCalled();
  expect(fake.model.prewarm).not.toHaveBeenCalled();
});

test('a newer switch or a cancel supersedes the one running', async () => {
  const { modes, steps } = switching();
  const first = modes.begin(InstructorMode.switchingToOffline);
  const second = modes.begin(InstructorMode.switchingToOnline);
  await jest.advanceTimersByTimeAsync(SwitchTiming.MIN_SWITCH_MS);
  expect(await first).toBeNull();
  expect(await second).toMatchObject({ mode: InstructorMode.online });
  expect(steps.filter(step => step.state !== 'starting')).toEqual(
    steps.filter(step => step.state !== 'starting' && step.switchId === 2),
  );
  const cancelled = modes.begin(InstructorMode.switchingToOffline);
  modes.cancel();
  const reported = steps.length;
  await jest.advanceTimersByTimeAsync(SwitchTiming.PIECE_TIMEOUT_MS);
  expect(steps).toHaveLength(reported);
  expect(jest.getTimerCount()).toBe(0);
  expect(await cancelled).toBeNull();
});
