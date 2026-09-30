import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import type { SplatViewSpec } from 'react-native-splat';
import App from '../App';
import { framingFor, highlightFor } from '../src/domain/derive';
import { SessionEventType } from '../src/domain/session';
import { bundledPack } from '../src/packs/bundledPack';
import {
  boundsForView,
  cameraLimitsInRadians,
  FRAME_SECONDS,
  homeDirectionInRadians,
  INITIAL_FRAME_SECONDS,
} from '../src/ui/camera';
import type { FieldGuideDebug } from '../src/ui/GuideScreen';
import { RADIANS_PER_POINT } from '../src/ui/SplatViewport';

// Native hosts are replaced while the screen, reducer and callbacks run together.
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
jest.mock('react-native-nitro-modules', () => ({
  callback: (fn: unknown) => fn,
}));
jest.mock('react-native-splat', () => ({ SplatView: 'SplatView' }));
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: number[]) => void, ...args: number[]) =>
    fn(...args),
}));
jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock').default;
  return {
    ...mock,
    useSafeAreaInsets: () => ({ top: 20, bottom: 34, left: 0, right: 0 }),
  };
});

const debug = () =>
  (globalThis as { fieldGuide?: FieldGuideDebug }).fieldGuide!;
function emit<T>(
  callback: ((event: T) => void) | undefined,
  event: Partial<T>,
) {
  callback?.(event as T);
}

describe('guide screen', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const native = () =>
    renderer.root.findByType('SplatView' as React.ElementType);
  const node = (testID: string) =>
    renderer.root
      .findAllByProps({ testID })
      .find(item => item.props.accessibilityRole === 'button') ??
    renderer.root.findByProps({ testID });
  const press = async (testID: string) => {
    await act(() => node(testID).props.onPress());
  };
  const view = {
    frame: jest.fn(),
    orbit: jest.fn(),
    dolly: jest.fn(),
    pick: jest.fn<Promise<number>, [number, number]>(),
  };
  const attach = async () => {
    await act(() => native().props.hybridRef(view as unknown as SplatViewSpec));
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
  });
  afterEach(async () => {
    await act(() => renderer.unmount());
  });

  test('starts the tour with safe-area padding, accessible controls and derived props', () => {
    const { pack, getState } = debug();
    const part = pack.parts.find(
      item => item.id === pack.procedures[0].steps[0].parts[0],
    )!;
    expect(node('guide-title').props.children).toBe(part.name);
    expect(node('guide-counter').props.children).toBe('1 of 8');
    expect(node('guide-back').props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(node('guide-next').props.accessibilityRole).toBe('button');
    expect(node('guide-card').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 50 })]),
    );
    expect(native().props.highlight).toEqual(highlightFor(getState(), pack));
    expect(native().props.cameraLimits).toEqual(
      cameraLimitsInRadians(pack.camera.limits),
    );
  });

  test('frames before ready without animation, then slides steps from home', async () => {
    await attach();
    const { pack, getState } = debug();
    expect(view.frame).toHaveBeenLastCalledWith(
      boundsForView(framingFor(getState(), pack)!),
      INITIAL_FRAME_SECONDS,
      homeDirectionInRadians(pack.camera.home),
    );
    await act(() => native().props.onReady());
    expect(view.frame).toHaveBeenCalledTimes(1);
    await press('guide-next');
    expect(view.frame).toHaveBeenLastCalledWith(
      boundsForView(framingFor(getState(), pack)!),
      FRAME_SECONDS,
      homeDirectionInRadians(pack.camera.home),
    );
    expect(node('guide-counter').props.children).toBe('2 of 8');
    await press('guide-back');
    expect(node('guide-counter').props.children).toBe('1 of 8');
  });

  test('selection keeps orbit direction; repeat and navigation restore the step', async () => {
    await attach();
    await act(() =>
      debug().dispatch({ type: SessionEventType.select, partId: 'battery' }),
    );
    const { pack, getState } = debug();
    expect(node('guide-title').props.children).toBe('Battery');
    expect(view.frame).toHaveBeenLastCalledWith(
      boundsForView(framingFor(getState(), pack)!),
      FRAME_SECONDS,
    );
    await press('guide-repeat');
    expect(getState().selectedPart).toBeNull();
    expect(view.frame.mock.calls.at(-1)).toHaveLength(3);
    await act(() =>
      debug().dispatch({ type: SessionEventType.select, partId: 'battery' }),
    );
    await press('guide-next');
    expect(getState()).toMatchObject({ selectedPart: null, stepIndex: 1 });
  });

  test('authored content and Start over use the active procedure', async () => {
    await act(() =>
      debug().dispatch({
        type: SessionEventType.start,
        procedureId: 'check-coolant',
      }),
    );
    expect(node('guide-title').props.children).toBe('Check the coolant level');
    const { pack, getState } = debug();
    for (let index = 1; index < pack.procedures[1].steps.length; index += 1) {
      await press('guide-next');
    }
    expect(node('guide-next').props.accessibilityLabel).toBe('Start over');
    await press('guide-next');
    expect(getState()).toMatchObject({
      procedureId: 'check-coolant',
      stepIndex: 0,
    });
  });

  test('card swipes ignore canceled gestures and respect the first boundary', async () => {
    const cardPan = () => jest.mocked(usePanGesture).mock.calls.at(-1)![0]!;
    await act(() =>
      emit(cardPan().onDeactivate, { canceled: false, translationX: 80 }),
    );
    expect(debug().getState().stepIndex).toBe(0);
    await act(() =>
      emit(cardPan().onDeactivate, { canceled: true, translationX: -80 }),
    );
    expect(debug().getState().stepIndex).toBe(0);
    await act(() =>
      emit(cardPan().onDeactivate, { canceled: false, translationX: -80 }),
    );
    expect(debug().getState().stepIndex).toBe(1);
    await act(() =>
      emit(cardPan().onDeactivate, { canceled: false, translationX: 80 }),
    );
    expect(debug().getState().stepIndex).toBe(0);
  });

  test('pan and pinch use update deltas; tap waits for both to fail', async () => {
    await attach();
    const pan = jest.mocked(usePanGesture).mock.calls.at(-2)![0]!;
    const pinch = jest.mocked(usePinchGesture).mock.calls.at(-1)![0]!;
    if (typeof pan.onUpdate === 'function') {
      emit(pan.onUpdate, { numberOfPointers: 1, changeX: 4, changeY: -2 });
      emit(pan.onUpdate, { numberOfPointers: 2, changeX: 100, changeY: 100 });
    }
    if (typeof pinch.onUpdate === 'function') {
      emit(pinch.onUpdate, { scaleChange: 1.1, scale: 2 });
    }
    expect(view.orbit).toHaveBeenCalledTimes(1);
    expect(view.orbit).toHaveBeenCalledWith(
      -4 * RADIANS_PER_POINT,
      -2 * RADIANS_PER_POINT,
    );
    expect(view.dolly).toHaveBeenCalledWith(1.1);
    expect(jest.mocked(useExclusiveGestures).mock.calls.at(-1)).toEqual([
      expect.objectContaining({
        kind: 'simultaneous',
        gestures: [
          expect.objectContaining({ kind: 'pan' }),
          expect.objectContaining({ kind: 'pinch' }),
        ],
      }),
      expect.objectContaining({ kind: 'tap' }),
    ]);
  });

  test('tap normalizes coordinates and maps labels, including empty space', async () => {
    await attach();
    await act(() =>
      node('guide-viewport').props.onLayout({
        nativeEvent: { layout: { width: 300, height: 400 } },
      }),
    );
    const tap = async (label: number) => {
      view.pick.mockResolvedValueOnce(label);
      await act(async () =>
        emit(jest.mocked(useTapGesture).mock.calls.at(-1)![0]!.onActivate, {
          x: 150,
          y: 100,
        }),
      );
    };
    await tap(4);
    expect(view.pick).toHaveBeenLastCalledWith(0.5, 0.25);
    expect(debug().getState().selectedPart).toBe('battery');
    await tap(255);
    expect(debug().getState().selectedPart).toBe('battery');
    await tap(0);
    expect(debug().getState().selectedPart).toBeNull();
  });

  test('a pending pick cannot override a newer step', async () => {
    await attach();
    await act(() =>
      node('guide-viewport').props.onLayout({
        nativeEvent: { layout: { width: 300, height: 400 } },
      }),
    );
    let resolve!: (label: number) => void;
    view.pick.mockReturnValueOnce(
      new Promise<number>(done => {
        resolve = done;
      }),
    );
    await act(() =>
      emit(jest.mocked(useTapGesture).mock.calls.at(-1)![0]!.onActivate, {
        x: 150,
        y: 100,
      }),
    );
    await press('guide-next');
    await act(async () => {
      resolve(4);
    });
    expect(debug().getState()).toMatchObject({
      stepIndex: 1,
      selectedPart: null,
    });
  });

  test('renderer errors appear without resetting the session', async () => {
    await press('guide-next');
    await act(() =>
      native().props.onError({
        code: 'load-failed',
        message: 'Cloud file missing',
      }),
    );
    expect(node('splat-error').props.children).toBe('Cloud file missing');
    expect(debug().getState().stepIndex).toBe(1);
  });

  test('invalid pack displays the parse message without mounting a renderer', async () => {
    const original = { ...bundledPack };
    try {
      Object.assign(bundledPack, {
        ok: false,
        error: { message: 'schema version 99 is not supported' },
      });
      await act(() => renderer.update(<App />));
      expect(node('pack-error').props.children).toBe(
        'schema version 99 is not supported',
      );
      expect(
        renderer.root.findAllByType('SplatView' as React.ElementType),
      ).toHaveLength(0);
      expect(
        (globalThis as { fieldGuide?: FieldGuideDebug }).fieldGuide,
      ).toBeUndefined();
    } finally {
      Object.assign(bundledPack, original);
    }
  });
});
