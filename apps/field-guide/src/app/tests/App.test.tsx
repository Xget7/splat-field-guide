import React from 'react';
import { Linking } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { instructorStore } from '../../features/instructor';
import { createAppInstructor } from '../startup/instructor';
import { getBundledPacks } from 'react-native-splat';
import { fixtureCopy } from '@tests/fixturePack';

// The real instructor, with its lifecycle observable.
jest.mock('../startup/instructor', () => {
  const actual = jest.requireActual('../startup/instructor');
  return {
    createAppInstructor: jest.fn(() => {
      const instructor = actual.createAppInstructor();
      jest.spyOn(instructor, 'start');
      jest.spyOn(instructor, 'stop');
      return instructor;
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
  const press = async (testID: string) => {
    const button = renderer.root
      .findAllByProps({ testID })
      .find(item => item.props.accessibilityRole === 'button')!;
    await act(() => button.props.onPress());
  };
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
    const instructor = instructorStore.getState().instructor!;
    expect(instructor).toBe(
      jest.mocked(createAppInstructor).mock.results[0].value,
    );
    expect(instructor.start).toHaveBeenCalledTimes(1);
    expect(instructor.stop).not.toHaveBeenCalled();
    await act(() => renderer.unmount());
    expect(instructor.stop).toHaveBeenCalledTimes(1);
  });

  test('opens on the library', async () => {
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    expect(
      renderer.root.findAllByProps({ testID: 'library-screen' }).length,
    ).toBeGreaterThan(0);
  });

  test('course entry does not mount an unavailable native scene', async () => {
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    await press('open-organization-miris');
    expect(
      renderer.root.findAllByProps({ testID: 'courses-empty' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByType('SplatView' as React.ElementType),
    ).toHaveLength(0);
  });

  test('a bundled pack opens free exploration through the workspace and course', async () => {
    jest.mocked(getBundledPacks).mockReturnValueOnce({
      manifests: () => [
        { directory: 'fixture/1', manifest: JSON.stringify(fixtureCopy()) },
      ],
    } as unknown as ReturnType<typeof getBundledPacks>);
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    await press('open-organization-miris');
    await press('open-course-automotive-assembly-line');
    const explore = renderer.root
      .findAllByProps({ testID: 'course-explore' })
      .find(item => item.props.accessibilityRole === 'button')!;
    await act(() => explore.props.onPress());
    expect(
      renderer.root.findAllByType('SplatView' as React.ElementType).length,
    ).toBeGreaterThan(0);
  });

  test('a broken bundled pack shows why instead of the library', async () => {
    jest.mocked(getBundledPacks).mockReturnValueOnce({
      manifests: () => [{ directory: 'fixture/1', manifest: '{' }],
    } as unknown as ReturnType<typeof getBundledPacks>);
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    expect(
      renderer.root.findByProps({ testID: 'pack-error' }).props.children,
    ).toBe('fixture/1: manifest is not JSON');
    expect(
      renderer.root.findAllByProps({ testID: 'library-screen' }),
    ).toHaveLength(0);
  });

  test('an unavailable native pack reader shows the startup error', async () => {
    jest.mocked(getBundledPacks).mockImplementationOnce(() => {
      throw new Error('BundledPacks is not registered');
    });
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    expect(
      renderer.root.findByProps({ testID: 'pack-error' }).props.children,
    ).toContain('BundledPacks is not registered');
    expect(
      renderer.root.findAllByType('SplatView' as React.ElementType),
    ).toHaveLength(0);
  });

  test('does not expose discarded AR or standalone benchmark routes', async () => {
    jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('fieldguide://bench');
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    expect(
      renderer.root.findAllByProps({ testID: 'library-screen' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'bench-screen' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ testID: 'open-ar-assembly' }),
    ).toHaveLength(0);
  });
});
