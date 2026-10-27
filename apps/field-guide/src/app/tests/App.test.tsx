import React from 'react';
import { Linking } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { BENCH_URL } from '../navigation/linking';
import { bundledPack } from '../../features/pack/bundledPack';
import { instructorStore } from '../../features/instructor';
import { createAppInstructor } from '../startup';

// The real instructor, with its lifecycle observable.
jest.mock('../startup', () => {
  const actual = jest.requireActual('../startup');
  return {
    createAppInstructor: jest.fn(() => {
      const runtime = actual.createAppInstructor();
      jest.spyOn(runtime, 'start');
      jest.spyOn(runtime, 'stop');
      return runtime;
    }),
  };
});

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
  beforeEach(() => instructorStore.getState().reset());
  afterEach(async () => {
    await act(() => renderer?.unmount());
  });

  test('creates one instructor on first render, starts it and stops it on unmount', async () => {
    jest.mocked(createAppInstructor).mockClear();
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    await act(() => renderer.update(<App />));
    expect(createAppInstructor).toHaveBeenCalledTimes(1);
    const runtime = instructorStore.getState().runtime!;
    expect(runtime).toBe(
      jest.mocked(createAppInstructor).mock.results[0].value,
    );
    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(runtime.stop).not.toHaveBeenCalled();
    await act(() => renderer.unmount());
    expect(runtime.stop).toHaveBeenCalledTimes(1);
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
