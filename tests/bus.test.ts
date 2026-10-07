import { createEventBus } from '../apps/field-guide/src/features/events/bus';

test('listeners receive current payloads until unsubscribed', () => {
  const bus = createEventBus<{ value: number }>();
  const listener = jest.fn();
  const unsubscribe = bus.on('value', listener);
  expect(bus.latest('value')).toBeUndefined();
  bus.emit('value', 1);
  unsubscribe();
  bus.emit('value', 2);
  expect(listener.mock.calls).toEqual([[1]]);
  expect(bus.latest('value')).toBe(2);
});

test('a failed listener does not prevent delivery to others', () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const bus = createEventBus<{ value: string }>();
  bus.on('value', () => {
    throw new Error('listener');
  });
  const listener = jest.fn();
  bus.on('value', listener);
  bus.emit('value', 'ready');
  expect(listener).toHaveBeenCalledWith('ready');
  expect(warning).toHaveBeenCalled();
  warning.mockRestore();
});
