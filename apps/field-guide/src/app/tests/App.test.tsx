import React from 'react';
import { Linking } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { BENCH_URL } from '../navigation/linking';
import { bundledPack } from '../../features/pack/bundledPack';

jest.mock('react-native-nitro-modules', () => ({
  callback: (fn: unknown) => fn,
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) =>
    children,
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  usePanGesture: jest.fn(config => ({ kind: 'pan', config })),
  usePinchGesture: jest.fn(config => ({ kind: 'pinch', config })),
  useTapGesture: jest.fn(config => ({ kind: 'tap', config })),
  useSimultaneousGestures: jest.fn((...gestures) => ({
    kind: 'simultaneous',
    gestures,
  })),
  useExclusiveGestures: jest.fn((...gestures) => ({
    kind: 'exclusive',
    gestures,
  })),
}));

describe('app', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  afterEach(async () => {
    await act(() => renderer.unmount());
  });

  test('opens on the library', async () => {
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    expect(
      renderer.root.findAllByProps({ testID: 'library-screen' }).length,
    ).toBeGreaterThan(0);
  });

  test('an invalid pack shows the parse message and no renderer', async () => {
    const original = { ...bundledPack };
    try {
      Object.assign(bundledPack, {
        ok: false,
        error: { message: 'schema version 99 is not supported' },
      });
      await act(() => {
        renderer = ReactTestRenderer.create(<App />);
      });
      expect(
        renderer.root.findByProps({ testID: 'pack-error' }).props.children,
      ).toBe('schema version 99 is not supported');
      expect(
        renderer.root.findAllByType('SplatView' as React.ElementType),
      ).toHaveLength(0);
    } finally {
      Object.assign(bundledPack, original);
    }
  });

  test('the bench link opens only the splat view, framed on the whole pack', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(BENCH_URL);
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    expect(
      renderer.root.findAllByProps({ testID: 'bench-screen' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'library-screen' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByType('SplatView' as React.ElementType),
    ).toHaveLength(1);
  });
});
