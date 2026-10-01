import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import type { SplatViewSpec } from 'react-native-splat';
import { catalogFor } from '../src/catalog/catalog';
import { CatalogProvider } from '../src/catalog/CatalogContext';
import { framingFor, highlightFor } from '../src/domain/derive';
import type { ProcedureId } from '../src/domain/pack';
import { SessionEventType } from '../src/domain/session';
import { TOUR_ID } from '../src/domain/tour';
import {
  LearnMode,
  Route,
  type RootStackParamList,
  type ScreenProps,
} from '../src/navigation/routes';
import { bundledPack } from '../src/packs/bundledPack';
import { loadProgress } from '../src/progress/progress';
import {
  ViewerScreen,
  type FieldGuideDebug,
} from '../src/screens/ViewerScreen';
import {
  boundsForView,
  cameraLimitsInRadians,
  FRAME_SECONDS,
  homeDirectionInRadians,
  inContext,
  INITIAL_FRAME_SECONDS,
} from '../src/screens/viewer/camera';
import { RADIANS_PER_POINT } from '../src/screens/viewer/SplatViewport';

// Native hosts are replaced while the screen, reducer and callbacks run together.
jest.mock('react-native-gesture-handler', () => ({
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
jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock').default;
  return {
    ...mock,
    useSafeAreaInsets: () => ({ top: 20, bottom: 34, left: 0, right: 0 }),
  };
});

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
const catalog = catalogFor(pack);
const VIEWPORT = { width: 300, height: 400 };

const debug = () =>
  (globalThis as { fieldGuide?: FieldGuideDebug }).fieldGuide!;
// Gesture callbacks may also be Animated events; these tests only pass functions.
function emit(callback: unknown, event: object) {
  (callback as ((value: object) => void) | undefined)?.(event);
}
const procedure = (id: ProcedureId) =>
  pack.procedures.find(item => item.id === id)!;

describe('viewer screen', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const native = () =>
    renderer.root.findByType('SplatView' as React.ElementType);
  const node = (testID: string) =>
    renderer.root
      .findAllByProps({ testID })
      .find(item => item.props.accessibilityRole === 'button') ??
    renderer.root.findByProps({ testID });
  const has = (testID: string) =>
    renderer.root.findAllByProps({ testID }).length > 0;
  const text = (testID: string) => node(testID).props.children;
  const press = async (testID: string) => {
    await act(() => node(testID).props.onPress());
  };
  const sheet = () => renderer.root.findByType(Modal);
  const view = {
    frame: jest.fn(),
    orbit: jest.fn(),
    dolly: jest.fn(),
    pick: jest.fn<Promise<number>, [number, number]>(),
    project: jest.fn(() => 0),
  };
  const mount = async (
    params: Partial<RootStackParamList[typeof Route.viewer]> = {},
  ) => {
    const props = {
      navigation,
      route: {
        key: 'viewer',
        name: Route.viewer,
        params: {
          guideId: pack.packId,
          procedureId: TOUR_ID,
          stepIndex: 0,
          mode: LearnMode.selfGuided,
          ...params,
        },
      },
    } as unknown as ScreenProps<typeof Route.viewer>;
    await act(() => {
      renderer = ReactTestRenderer.create(
        <CatalogProvider catalog={catalog}>
          <ViewerScreen {...props} />
        </CatalogProvider>,
      );
    });
  };
  const layout = async (size = VIEWPORT) => {
    await act(() =>
      node('viewer-viewport').props.onLayout({ nativeEvent: { layout: size } }),
    );
  };
  const attach = async () => {
    await act(() => native().props.hybridRef(view as unknown as SplatViewSpec));
    await layout();
  };
  const lastFraming = () =>
    boundsForView(inContext(framingFor(debug().getState(), pack)!));
  const home = homeDirectionInRadians(pack.camera.home);

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });
  afterEach(async () => {
    await act(() => renderer.unmount());
  });

  test('opens the requested step with safe-area padding and derived props', async () => {
    await mount({ procedureId: 'check-coolant', stepIndex: 1 });
    const { getState } = debug();
    expect(getState()).toEqual({
      procedureId: 'check-coolant',
      stepIndex: 1,
      selectedPart: null,
    });
    expect(text('step-counter')).toBe('STEP 02 / 05');
    expect(text('step-title')).toBe('Coolant reservoir');
    expect(node('procedure-button').props.accessibilityLabel).toBe(
      'Procedure: Check the coolant level',
    );
    expect(node('step-panel').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 46 })]),
    );
    expect(native().props.highlight).toEqual(highlightFor(getState(), pack));
    expect(native().props.cameraLimits).toEqual(
      cameraLimitsInRadians(pack.camera.limits),
    );
  });

  test('frames once laid out without animation, then slides steps from home', async () => {
    await mount();
    await act(() => native().props.hybridRef(view as unknown as SplatViewSpec));
    expect(view.frame).not.toHaveBeenCalled();
    await layout();
    expect(view.frame).toHaveBeenLastCalledWith(
      lastFraming(),
      INITIAL_FRAME_SECONDS,
      home,
    );
    await act(() => native().props.onReady());
    expect(view.frame).toHaveBeenCalledTimes(1);
    await press('step-next');
    expect(view.frame).toHaveBeenLastCalledWith(
      lastFraming(),
      FRAME_SECONDS,
      home,
    );
    expect(text('step-counter')).toBe('STEP 02 / 08');
    await press('step-back');
    expect(text('step-counter')).toBe('STEP 01 / 08');
  });

  test('repeat and a new viewport size frame the step again', async () => {
    await mount();
    await attach();
    const calls = view.frame.mock.calls.length;
    await press('step-repeat');
    expect(view.frame).toHaveBeenCalledTimes(calls + 1);
    await layout(VIEWPORT);
    expect(view.frame).toHaveBeenCalledTimes(calls + 1);
    await layout({ width: 300, height: 250 });
    expect(view.frame).toHaveBeenCalledTimes(calls + 2);
    expect(view.frame).toHaveBeenLastCalledWith(
      lastFraming(),
      FRAME_SECONDS,
      home,
    );
  });

  test('selection keeps the orbit direction; repeat and Next restore the step', async () => {
    await mount();
    await attach();
    await act(() =>
      debug().dispatch({ type: SessionEventType.select, partId: 'battery' }),
    );
    expect(text('step-title')).toBe('Battery');
    expect(node('step-repeat').props.accessibilityLabel).toBe('Back to step');
    expect(view.frame).toHaveBeenLastCalledWith(lastFraming(), FRAME_SECONDS);
    await press('step-repeat');
    expect(debug().getState().selectedPart).toBeNull();
    expect(view.frame.mock.calls.at(-1)).toHaveLength(3);
    await act(() =>
      debug().dispatch({ type: SessionEventType.select, partId: 'battery' }),
    );
    await press('step-next');
    expect(debug().getState()).toMatchObject({
      selectedPart: null,
      stepIndex: 1,
    });
  });

  test('the last step finishes: progress is cleared and the viewer closes', async () => {
    const steps = procedure('check-coolant').steps.length;
    await mount({ procedureId: 'check-coolant', stepIndex: steps - 2 });
    await act(async () => {});
    expect(await loadProgress()).toEqual({
      guideId: pack.packId,
      procedureId: 'check-coolant',
      stepIndex: steps - 2,
    });
    await press('step-next');
    expect(await loadProgress()).toMatchObject({ stepIndex: steps - 1 });
    expect(node('step-next').props.accessibilityState).toEqual({
      disabled: false,
    });
    await press('step-next');
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(await loadProgress()).toBeNull();
  });

  test('progress is kept only past the first step', async () => {
    await mount({ procedureId: 'check-coolant', stepIndex: 1 });
    await act(async () => {});
    expect(await loadProgress()).toMatchObject({ stepIndex: 1 });
    await press('step-back');
    expect(await loadProgress()).toBeNull();
  });

  test('a caution shows only on the step that has one', async () => {
    await mount({ procedureId: 'check-coolant', stepIndex: 0 });
    expect(node('caution').props.accessibilityLabel).toBe(
      `Caution: ${procedure('check-coolant').steps[0].caution}`,
    );
    await press('step-next');
    expect(has('caution')).toBe(false);
  });

  test('picker opens without changing the session or remounting the renderer', async () => {
    await mount();
    await attach();
    await press('step-next');
    const state = debug().getState();
    const splat = native();
    const frameCalls = view.frame.mock.calls.length;
    expect(sheet().props.visible).toBe(false);
    await press('procedure-button');
    expect(sheet().props).toMatchObject({
      testID: 'procedure-sheet',
      visible: true,
      presentationStyle: 'pageSheet',
      allowSwipeDismissal: true,
    });
    for (const { id } of pack.procedures) {
      expect(node(`procedure-row-${id}`).props.accessibilityState).toEqual({
        selected: id === TOUR_ID,
      });
    }
    expect(debug().getState()).toBe(state);
    expect(native()).toBe(splat);
    expect(view.frame).toHaveBeenCalledTimes(frameCalls);
  });

  test.each([
    'check-coolant',
    'check-brake-fluid',
    'check-power-steering-fluid',
  ])('picker starts %s at step one and closes', async procedureId => {
    await mount();
    await act(() =>
      debug().dispatch({ type: SessionEventType.select, partId: 'battery' }),
    );
    await press('procedure-button');
    await press(`procedure-row-${procedureId}`);
    expect(debug().getState()).toEqual({
      procedureId,
      stepIndex: 0,
      selectedPart: null,
    });
    expect(sheet().props.visible).toBe(false);
    expect(text('step-counter')).toBe('STEP 01 / 05');
    expect(text('step-title')).toBe(
      procedure(procedureId)
        .steps[0].parts.map(id => pack.parts.find(part => part.id === id)!.name)
        .join(', '),
    );
  });

  test.each(['Done', 'swipe'])(
    'closing the picker with %s leaves the session unchanged',
    async method => {
      await mount();
      await press('step-next');
      const state = debug().getState();
      await press('procedure-button');
      if (method === 'Done') {
        await press('procedure-done');
      } else {
        await act(() => sheet().props.onRequestClose());
      }
      expect(sheet().props.visible).toBe(false);
      expect(debug().getState()).toBe(state);
    },
  );

  test('panel swipes ignore canceled gestures, the ends, and never finish', async () => {
    await mount({ procedureId: 'check-coolant', stepIndex: 0 });
    const swipe = () => jest.mocked(usePanGesture).mock.calls.at(-1)![0]!;
    const fling = async (translationX: number, canceled = false) =>
      act(() => emit(swipe().onDeactivate, { canceled, translationX }));
    await fling(80);
    expect(debug().getState().stepIndex).toBe(0);
    await fling(-80, true);
    expect(debug().getState().stepIndex).toBe(0);
    for (let swipes = 0; swipes < 10; swipes++) {
      await fling(-80);
    }
    expect(debug().getState().stepIndex).toBe(4);
    expect(navigation.goBack).not.toHaveBeenCalled();
    await fling(80);
    expect(debug().getState().stepIndex).toBe(3);
  });

  test('pan and pinch use update deltas; tap waits for both to fail', async () => {
    await mount();
    await attach();
    const pan = jest
      .mocked(usePanGesture)
      .mock.calls.map(call => call[0]!)
      .filter(config => typeof config.onUpdate === 'function')
      .at(-1)!;
    const pinch = jest.mocked(usePinchGesture).mock.calls.at(-1)![0]!;
    emit(pan.onUpdate, { numberOfPointers: 1, changeX: 4, changeY: -2 });
    emit(pan.onUpdate, { numberOfPointers: 2, changeX: 100, changeY: 100 });
    emit(pinch.onUpdate, { scaleChange: 1.1, scale: 2 });
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
    await mount();
    await attach();
    const tap = async (label: number) => {
      view.pick.mockResolvedValueOnce(label);
      await act(async () =>
        emit(jest.mocked(useTapGesture).mock.calls.at(-1)![0]!.onActivate, {
          x: 150,
          y: 100,
        }),
      );
    };
    const battery = pack.parts.find(part => part.id === 'battery')!;
    await tap(battery.label);
    expect(view.pick).toHaveBeenLastCalledWith(0.5, 0.25);
    expect(debug().getState().selectedPart).toBe('battery');
    await tap(255);
    expect(debug().getState().selectedPart).toBe('battery');
    await tap(0);
    expect(debug().getState().selectedPart).toBeNull();
  });

  test('a pending pick cannot override a newer step', async () => {
    await mount();
    await attach();
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
    await press('step-next');
    await act(async () => {
      resolve(pack.parts[0].label);
    });
    expect(debug().getState()).toMatchObject({
      stepIndex: 1,
      selectedPart: null,
    });
  });

  test('loading shows until ready; renderer errors keep the session', async () => {
    await mount();
    expect(text('splat-loading')).toBe('Loading 2.5M splats');
    expect(has('marker-0')).toBe(false);
    await act(() => native().props.onReady());
    expect(has('splat-loading')).toBe(false);
    expect(node('marker-0').props.accessibilityLabel).toBe(
      `${text('step-title')}, highlighted`,
    );
    await press('step-next');
    await act(() =>
      native().props.onError({ code: 'load-failed', message: 'Cloud missing' }),
    );
    expect(text('splat-error')).toBe('Cloud missing');
    expect(debug().getState().stepIndex).toBe(1);
  });

  test('marks every part a step names', async () => {
    await mount({ procedureId: 'check-power-steering-fluid', stepIndex: 0 });
    await act(() => native().props.onReady());
    expect(
      [0, 1].map(index => node(`marker-${index}`).props.accessibilityLabel),
    ).toEqual([
      'Power steering reservoir, highlighted',
      'Coolant reservoir, highlighted',
    ]);
  });

  describe('instructor', () => {
    test('opens in Instructor mode with the step said and the toggle on', async () => {
      await mount({
        procedureId: 'check-coolant',
        stepIndex: 0,
        mode: LearnMode.instructor,
      });
      const first = procedure('check-coolant').steps[0];
      expect(has('step-panel')).toBe(false);
      expect(text('instructor-reply')).toBe(first.text);
      expect(node('caution').props.accessibilityLabel).toBe(
        `Caution: ${first.caution}`,
      );
      expect(has('instructor-question')).toBe(false);
      expect(node('instructor-toggle').props.accessibilityState).toEqual({
        selected: true,
      });
      await press('instructor-toggle');
      expect(has('instructor-panel')).toBe(false);
      expect(text('step-counter')).toBe('STEP 01 / 05');
    });

    test('a typed question shows the part and the answer', async () => {
      await mount({ mode: LearnMode.instructor });
      await act(() =>
        node('instructor-input').props.onChangeText('Where is the battery?'),
      );
      expect(node('instructor-send').props.accessibilityState).toEqual({
        disabled: false,
      });
      await act(() => node('instructor-input').props.onSubmitEditing());
      const battery = pack.parts.find(part => part.id === 'battery')!;
      expect(debug().getState().selectedPart).toBe('battery');
      expect(text('instructor-question')).toBe('> Where is the battery?');
      expect(text('instructor-reply')).toBe(battery.summary);
      expect(node('instructor-input').props.value).toBe('');
      expect(native().props.highlight).toEqual([battery.label]);
    });

    test('a suggestion moves the procedure on and the buttons agree', async () => {
      await mount({
        procedureId: 'check-coolant',
        stepIndex: 1,
        mode: LearnMode.instructor,
      });
      await press('suggestion-Next step');
      expect(debug().getState().stepIndex).toBe(2);
      expect(text('instructor-reply')).toBe(
        procedure('check-coolant').steps[2].text,
      );
      await press('instructor-toggle');
      expect(text('step-counter')).toBe('STEP 03 / 05');
    });

    test('debug ask drives the same path for end-to-end checks', async () => {
      await mount({ mode: LearnMode.instructor });
      await act(() => debug().ask('how do I check the brake fluid'));
      expect(debug().getState()).toEqual({
        procedureId: 'check-brake-fluid',
        stepIndex: 0,
        selectedPart: null,
      });
    });
  });

  test('a guide that is not in the catalog offers only a way back', async () => {
    await mount({ guideId: 'drilling-rig-top-drive' });
    expect(
      renderer.root.findAllByType('SplatView' as React.ElementType),
    ).toEqual([]);
    await press('viewer-back');
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
