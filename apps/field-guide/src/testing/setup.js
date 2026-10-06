/* eslint-env jest */

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async key => store.get(key) ?? null),
      setItem: jest.fn(async (key, value) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async key => {
        store.delete(key);
      }),
      clear: jest.fn(async () => {
        store.clear();
      }),
    },
  };
});

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
  Rect: 'Rect',
}));

// The viewer's part markers animate on the UI thread, which jest does not have.
jest.mock('react-native-worklets', () =>
  require('react-native-worklets/src/mock'),
);
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const mock = require('react-native-reanimated/mock');
  const linearTransition = Object.create(mock.LinearTransition);
  linearTransition.springify = () => {
    const transition = Object.create(mock.LinearTransition);
    transition.withCallback = callback => {
      transition.callbackV = callback;
      return transition;
    };
    return transition;
  };
  return {
    ...mock,
    LinearTransition: linearTransition,
    useReducedMotion: jest.fn(() => false),
    useSharedValue: initial => {
      const reference = React.useRef(null);
      if (reference.current === null) {
        reference.current = mock.useSharedValue(initial);
      }
      return reference.current;
    },
    withRepeat: jest.fn(mock.withRepeat),
    withTiming: jest.fn(mock.withTiming),
    withSpring: jest.fn(mock.withSpring),
    withSequence: jest.fn(mock.withSequence),
  };
});

// Tests never reach the network: the shared cloud model has no proxy, and cloud tests
// build their own with a fake request.
jest.mock('../instructor/models/cloudModel', () => {
  const actual = jest.requireActual('../instructor/models/cloudModel');
  return { ...actual, cloudModel: actual.createCloudModel({ url: null }) };
});

// Native capabilities are opt-in in tests; callbacks and promises can be controlled per case.
jest.mock('react-native-on-device', () => {
  const model = {
    availability: jest.fn(() => 'unavailable'),
    prewarm: jest.fn(),
    respond: jest.fn(),
    cancel: jest.fn(),
  };
  const input = {
    requestPermission: jest.fn(async () => 'granted'),
    prepare: jest.fn(async () => 'available'),
    listen: jest.fn(
      async (
        _locale,
        _hints,
        _onPartial,
        _onTurn,
        _onLevel,
        _onVoice,
        _onStopped,
      ) => {},
    ),
    cancel: jest.fn(),
  };
  const output = {
    speak: jest.fn(async (_text, _locale, _onWord) => {}),
    stop: jest.fn(),
  };
  return {
    languageModel: jest.fn(() => model),
    speechInput: jest.fn(() => input),
    speechOutput: jest.fn(() => output),
    emitLevel: level => input.listen.mock.calls.at(-1)?.[4]?.(level),
    emitWord: (location, length) =>
      output.speak.mock.calls.at(-1)?.[2]?.(location, length),
  };
});

// React Native's test window is 750 points wide, an iPad's width class; screens are tested as
// on an iPhone unless a test opens a wider window.
const PHONE_WINDOW = { width: 393, height: 852, scale: 3, fontScale: 1 };
require('react-native').Dimensions.set({
  window: PHONE_WINDOW,
  screen: PHONE_WINDOW,
});
