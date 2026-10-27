import { fakePlatform } from '@tests/platform';
import {
  createModeSwitching,
  OfflineVoices,
  SwitchTiming,
  type ModeSwitchingOptions,
  type OfflineVoice,
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
import { fixturePack } from '@tests/fixturePack';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** A switcher over the fake platform whose online pieces succeed unless the test says otherwise. */
function switching(
  options: Partial<ModeSwitchingOptions> & { offlineVoice?: OfflineVoice } = {},
) {
  const fake = fakePlatform();
  const steps: SwitchStep[] = [];
  const modes = createModeSwitching({
    ...fake.platform,
    input: fake.platform.speechInput,
    output: fake.platform.speechOutput,
    offlineVoice: OfflineVoices.kokoro,
    device: createDeviceAnswerer(fake.platform.languageModel),
    pack: () => fixturePack(),
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
    sources: { voice: VoiceSource.device, answers: AnswerSource.claude },
  });
  expect(steps[2].switchId).toBe(1);
});

test('a hanging piece falls back at eight seconds and never emits a late ready', async () => {
  const { modes, steps, fake } = switching();
  let resolve!: (availability: 'available') => void;
  fake.input.prepare.mockReturnValueOnce(
    new Promise(done => {
      resolve = done;
    }),
  );
  const result = modes.begin(InstructorMode.switchingToOffline);
  await jest.advanceTimersByTimeAsync(SwitchTiming.PIECE_TIMEOUT_MS);
  expect(await result).toMatchObject({ mode: InstructorMode.offline });
  const listening = () =>
    steps.filter(step => step.piece === SwitchPiece.listening);
  expect(listening().at(-1)).toEqual({
    switchId: 1,
    piece: 'listening',
    state: 'fallback',
    label: SwitchLabel.noListening,
  });
  resolve('available');
  await Promise.resolve();
  expect(listening()).toHaveLength(2);
});

test('an offline switch prepares every offline piece and answers from the script without a device model', async () => {
  const { modes, steps } = switching();
  const result = modes.begin(InstructorMode.switchingToOffline);
  await jest.advanceTimersByTimeAsync(SwitchTiming.MIN_SWITCH_MS);
  expect(await result).toEqual({
    mode: InstructorMode.offline,
    sources: { voice: VoiceSource.device, answers: AnswerSource.script },
  });
  expect(steps.at(-1)).toMatchObject({
    state: 'ready',
    piece: 'listening',
    label: SwitchLabel.deviceListening,
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

test.each([
  {
    platform: 'android',
    offlineVoice: OfflineVoices.system,
    label: 'Voice: system voice',
    voice: 'system',
  },
  {
    platform: 'ios',
    offlineVoice: OfflineVoices.kokoro,
    label: 'Voice: Kokoro',
    voice: 'kokoro',
  },
] as const)(
  '$platform names and starts its configured offline voice',
  async ({ offlineVoice, label, voice }) => {
    const { modes, steps, fake } = switching({ offlineVoice });
    const result = modes.begin(InstructorMode.switchingToOffline);
    await jest.advanceTimersByTimeAsync(SwitchTiming.MIN_SWITCH_MS);
    await result;
    expect(steps.filter(step => step.piece === SwitchPiece.voice)).toEqual([
      expect.objectContaining({ state: 'starting', label }),
      expect.objectContaining({ state: 'ready', label }),
    ]);
    expect(fake.output.prepare).toHaveBeenCalledWith(voice);
  },
);

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
