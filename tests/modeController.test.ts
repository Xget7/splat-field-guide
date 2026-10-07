import {
  createModeController,
  ModeTiming,
} from '../apps/field-guide/src/features/instructor/mode/modeController';
import {
  ModeRequestType,
  NetworkQuality,
  Transport,
} from '../apps/field-guide/src/features/events/types';

const network = (quality: NetworkQuality) => ({
  quality,
  transport: Transport.wifi,
  reason: 'test',
});
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
function setup(quality: NetworkQuality = NetworkQuality.good) {
  const emitMode = jest.fn();
  const emitSuggestion = jest.fn();
  const controller = createModeController({ emitMode, emitSuggestion });
  controller.network(network(quality));
  return { controller, emitMode, emitSuggestion };
}
test('startup selects the mode and loss switches even during a reply', () => {
  const { controller, emitMode } = setup();
  expect(emitMode).toHaveBeenLastCalledWith(
    expect.objectContaining({ mode: 'online', cause: 'startup' }),
  );
  controller.setIdle(false);
  controller.network(network(NetworkQuality.offline));
  expect(controller.current()).toMatchObject({
    mode: 'switchingToOffline',
    cause: 'network',
  });
  expect(setup(NetworkQuality.offline).controller.current().mode).toBe(
    'offline',
  );
});
test('weak signal can be snoozed for five minutes or accepted', () => {
  const { controller, emitSuggestion } = setup();
  controller.network(network(NetworkQuality.weak));
  jest.advanceTimersByTime(ModeTiming.SUGGESTION_DELAY_MS);
  expect(emitSuggestion).toHaveBeenLastCalledWith({
    mode: 'offline',
    reason: 'weak',
  });
  controller.request({ type: ModeRequestType.dismissSuggestion });
  expect(emitSuggestion).toHaveBeenLastCalledWith(null);
  jest.advanceTimersByTime(1000);
  controller.request({ type: ModeRequestType.dismissSuggestion });
  expect(jest.getTimerCount()).toBe(1);
  jest.advanceTimersByTime(ModeTiming.SUGGESTION_SNOOZE_MS - 1);
  expect(emitSuggestion).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(1);
  expect(emitSuggestion).toHaveBeenLastCalledWith({
    mode: 'offline',
    reason: 'weak',
  });
  controller.request({ type: ModeRequestType.acceptSuggestion });
  expect(controller.current()).toMatchObject({
    mode: 'switchingToOffline',
    cause: 'user',
  });
});
test('recovery requires uninterrupted good quality and then idle', () => {
  const { controller } = setup(NetworkQuality.offline);
  controller.setIdle(false);
  controller.network(network(NetworkQuality.good));
  jest.advanceTimersByTime(ModeTiming.RECOVERY_MS - 1);
  controller.network(network(NetworkQuality.weak));
  controller.network(network(NetworkQuality.good));
  jest.advanceTimersByTime(ModeTiming.RECOVERY_MS - 1);
  expect(controller.current().mode).toBe('offline');
  jest.advanceTimersByTime(1);
  expect(controller.current().mode).toBe('offline');
  controller.setIdle(true);
  expect(controller.current()).toMatchObject({
    mode: 'switchingToOnline',
    cause: 'recovered',
  });
});
test('a connection lost again soon after recovering waits twice as long to recover', () => {
  const { controller } = setup(NetworkQuality.offline);
  controller.network(network(NetworkQuality.good));
  jest.advanceTimersByTime(ModeTiming.RECOVERY_MS);
  controller.switched('online', { voice: 'agent', answers: 'claude' });
  jest.advanceTimersByTime(ModeTiming.STABLE_MS - 1);
  controller.network(network(NetworkQuality.offline));
  controller.switched('offline', { voice: 'device', answers: 'deviceModel' });
  controller.network(network(NetworkQuality.good));
  jest.advanceTimersByTime(ModeTiming.RECOVERY_MS * 2 - 1);
  expect(controller.current().mode).toBe('offline');
  jest.advanceTimersByTime(1);
  expect(controller.current().mode).toBe('switchingToOnline');
});
test('agent availability changes only voice and redundant calls do not emit', () => {
  const { controller, emitMode } = setup();
  const initial = controller.current();
  controller.agentAvailable(false);
  expect(controller.current()).toEqual({ ...initial, voice: 'device' });
  expect(controller.current()).not.toBe(initial);
  controller.agentAvailable(false);
  controller.network(network(NetworkQuality.good));
  expect(emitMode).toHaveBeenCalledTimes(2);
});

test('a brief weak signal cannot show a suggestion or switch the conversation', () => {
  const { controller, emitMode, emitSuggestion } = setup();
  controller.network(network(NetworkQuality.weak));
  jest.advanceTimersByTime(1000);
  controller.network(network(NetworkQuality.good));
  jest.advanceTimersByTime(1000);
  expect(emitSuggestion).not.toHaveBeenCalled();
  expect(emitMode.mock.calls.map(([status]) => status.mode)).toEqual([
    'online',
  ]);
});

test('a held weak signal shows a suggestion until good quality stays recovered', () => {
  const { controller, emitSuggestion } = setup();
  controller.network(network(NetworkQuality.weak));
  jest.advanceTimersByTime(ModeTiming.SUGGESTION_DELAY_MS - 1);
  expect(emitSuggestion).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(emitSuggestion).toHaveBeenLastCalledWith({
    mode: 'offline',
    reason: 'weak',
  });
  controller.network(network(NetworkQuality.good));
  jest.advanceTimersByTime(1000);
  controller.network(network(NetworkQuality.weak));
  expect(emitSuggestion.mock.calls.map(([value]) => value)).toEqual([
    { mode: 'offline', reason: 'weak' },
  ]);
  controller.network(network(NetworkQuality.good));
  jest.advanceTimersByTime(ModeTiming.RECOVERY_MS - 1);
  expect(emitSuggestion).toHaveBeenLastCalledWith({
    mode: 'offline',
    reason: 'weak',
  });
  jest.advanceTimersByTime(1);
  expect(emitSuggestion).toHaveBeenLastCalledWith(null);
});

test('dispose cancels suggestion, withdrawal, snooze and recovery callbacks', () => {
  const cases = [
    () => {
      const value = setup();
      value.controller.network(network(NetworkQuality.weak));
      return value;
    },
    () => {
      const value = setup();
      value.controller.network(network(NetworkQuality.weak));
      jest.advanceTimersByTime(ModeTiming.SUGGESTION_DELAY_MS);
      value.controller.network(network(NetworkQuality.good));
      return value;
    },
    () => {
      const value = setup();
      value.controller.request({ type: ModeRequestType.dismissSuggestion });
      value.controller.request({ type: ModeRequestType.dismissSuggestion });
      return value;
    },
    () => {
      const value = setup(NetworkQuality.offline);
      value.controller.network(network(NetworkQuality.good));
      return value;
    },
  ];
  for (const prepare of cases) {
    const { controller, emitMode, emitSuggestion } = prepare();
    controller.dispose();
    expect(jest.getTimerCount()).toBe(0);
    const modes = [...emitMode.mock.calls];
    const suggestions = [...emitSuggestion.mock.calls];
    jest.runAllTimers();
    expect(emitMode.mock.calls).toEqual(modes);
    expect(emitSuggestion.mock.calls).toEqual(suggestions);
    expect(jest.getTimerCount()).toBe(0);
  }
});
