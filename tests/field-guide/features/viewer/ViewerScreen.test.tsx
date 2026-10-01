import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Keyboard, Modal, StyleSheet } from 'react-native';
import {
  useReducedMotion,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  languageModel,
  speechInput,
  speechOutput,
} from 'react-native-on-device';
import {
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import type { SplatViewSpec } from 'react-native-splat';
import { catalogFor } from '../../../../apps/field-guide/src/modules/catalog/catalog';
import { CatalogProvider } from '../../../../apps/field-guide/src/modules/catalog/CatalogContext';
import {
  framingFor,
  highlightFor,
} from '../../../../apps/field-guide/src/domain/derive';
import type { ProcedureId } from '../../../../apps/field-guide/src/domain/pack';
import { SessionEventType } from '../../../../apps/field-guide/src/domain/session';
import { TOUR_ID } from '../../../../apps/field-guide/src/domain/tour';
import {
  LearnMode,
  Route,
  type RootStackParamList,
  type ScreenProps,
} from '../../../../apps/field-guide/src/shared/navigation/routes';
import { bundledPack } from '../../../../apps/field-guide/src/modules/packs/bundledPack';
import { loadProgress } from '../../../../apps/field-guide/src/modules/progress/data/progressStorage';
import {
  ViewerScreen,
  type FieldGuideDebug,
} from '../../../../apps/field-guide/src/features/viewer/screens/ViewerScreen';
import {
  boundsForView,
  cameraLimitsInRadians,
  FRAME_SECONDS,
  homeDirectionInRadians,
  inContext,
  INITIAL_FRAME_SECONDS,
} from '../../../../apps/field-guide/src/features/viewer/model/camera';
import { RADIANS_PER_POINT } from '../../../../apps/field-guide/src/features/viewer/components/SplatViewport';
import { onDeviceInstructions } from '../../../../apps/field-guide/src/modules/instructor/data/onDeviceModel';
import {
  Color,
  Motion,
} from '../../../../apps/field-guide/src/shared/ui/theme';
import { InstructorPanel } from '../../../../apps/field-guide/src/features/viewer/components/InstructorPanel';
import { InstructorTalk } from '../../../../apps/field-guide/src/features/viewer/components/InstructorMotion';
import {
  PanelMode,
  PanelPan,
} from '../../../../apps/field-guide/src/features/viewer/model/panelMotion';
import {
  MIN_HOLD_MS,
  VoiceHint,
  VOICE_LOCALE,
} from '../../../../apps/field-guide/src/modules/instructor/voice/hooks/useInstructorVoice';
import { recognitionHintsFor } from '../../../../apps/field-guide/src/modules/instructor/voice/model/recognitionHints';

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
const model = languageModel();
const input = speechInput();
const output = speechOutput();
const voiceEvents = jest.requireMock('react-native-on-device') as {
  emitLevel: (level: number) => void;
  emitWord: (location: number, length: number) => void;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const modelReply = (reply = 'It supplies the starter.') => reply;

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
    await act(async () => node(testID).props.onPress());
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
    await act(async () => {
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
    jest.mocked(useReducedMotion).mockReturnValue(false);
    jest.mocked(model.availability).mockReturnValue('unavailable');
    jest.mocked(model.respond).mockReset();
    jest
      .mocked(input.requestPermission)
      .mockReset()
      .mockResolvedValue('granted');
    jest.mocked(input.availability).mockReturnValue('available');
    jest.mocked(input.start).mockReset().mockResolvedValue();
    jest.mocked(input.finish).mockReset().mockResolvedValue('');
    jest.mocked(output.speak).mockReset().mockResolvedValue();
    await AsyncStorage.clear();
  });
  afterEach(async () => {
    await act(() => renderer.unmount());
    jest.restoreAllMocks();
  });

  test('opens the requested step with safe-area padding and derived props', async () => {
    await mount({ procedureId: 'check-coolant', stepIndex: 1 });
    const { getState } = debug();
    expect(getState()).toEqual({
      procedureId: 'check-coolant',
      stepIndex: 1,
      selectedPart: null,
    });
    expect(text('step-counter')).toBe('Step 02 / 05');
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
    expect(text('step-counter')).toBe('Step 02 / 08');
    await press('step-back');
    expect(text('step-counter')).toBe('Step 01 / 08');
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
    expect(text('step-counter')).toBe('Step 01 / 05');
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
    const ask = async (question: string) =>
      act(async () => debug().ask(question));
    const startHold = async () =>
      act(async () => node('instructor-talk').props.onPressIn());
    const releaseHold = async () =>
      act(async () => node('instructor-talk').props.onPressOut());
    const clock = () => jest.spyOn(Date, 'now').mockReturnValue(1000);
    const panel = () => renderer.root.findByType(InstructorPanel);
    const settleViewport = async (finished = true) =>
      act(async () => node('viewer-viewport').props.layout.callbackV(finished));

    test('the tour talks: it reads the first part on open and each step it moves to', async () => {
      const said = () =>
        jest.mocked(output.speak).mock.calls.map(([spoken]) => spoken);
      await mount({ mode: LearnMode.instructor });
      const tour = procedure('tour');
      expect(said()).toEqual([tour.steps[0].text]);
      await press('instructor-next');
      expect(said()).toEqual([tour.steps[0].text, tour.steps[1].text]);
      await press('instructor-back');
      expect(said()).toEqual([
        tour.steps[0].text,
        tour.steps[1].text,
        tour.steps[0].text,
      ]);
    });

    test('an answer is said once and does not bring the step back', async () => {
      await mount({ mode: LearnMode.instructor });
      jest.mocked(output.speak).mockClear();
      await ask('Where is the battery?');
      await ask('Where is the battery?');
      expect(
        jest.mocked(output.speak).mock.calls.map(([said]) => said),
      ).toEqual([
        pack.parts.find(part => part.id === 'battery')!.summary,
        pack.parts.find(part => part.id === 'battery')!.summary,
      ]);
    });

    test('the self-guided panel stays silent', async () => {
      await mount();
      await press('step-next');
      expect(output.speak).not.toHaveBeenCalled();
    });

    test('step controls return from a question to the guide and save navigation', async () => {
      await mount({ mode: LearnMode.instructor });
      await attach();
      expect(node('instructor-back').props.accessibilityState.disabled).toBe(
        true,
      );
      await ask('Where is the battery?');
      expect(debug().getState().selectedPart).toBe('battery');
      await press('instructor-next');
      expect(debug().getState()).toMatchObject({
        selectedPart: null,
        stepIndex: 1,
      });
      expect(text('instructor-status')).toBe('Step 02 / 08');
      expect(text('instructor-reply')).toBe(procedure('tour').steps[1].text);
      expect(has('instructor-question')).toBe(false);
      expect(native().props.highlight).toEqual(
        highlightFor(debug().getState(), pack),
      );
      expect(view.frame).toHaveBeenLastCalledWith(
        lastFraming(),
        FRAME_SECONDS,
        home,
      );
      expect(await loadProgress()).toMatchObject({ stepIndex: 1 });
      await press('instructor-back');
      expect(debug().getState().stepIndex).toBe(0);
      expect(text('instructor-reply')).toBe(procedure('tour').steps[0].text);
      expect(await loadProgress()).toBeNull();
    });

    test('Next remains available while compact or using the keyboard', async () => {
      await mount({ mode: LearnMode.instructor });
      await press('instructor-header');
      await press('instructor-next');
      expect(panel().props.mode).toBe(PanelMode.minimized);
      expect(text('instructor-preview')).toBe(procedure('tour').steps[1].text);
      await press('instructor-header');
      await press('instructor-keyboard');
      await press('instructor-next');
      expect(has('instructor-input')).toBe(true);
      expect(debug().getState().stepIndex).toBe(2);
      expect(text('instructor-reply')).toBe(procedure('tour').steps[2].text);
    });

    test('Finish stops the instructor, clears progress and closes the guide', async () => {
      const steps = procedure('check-coolant').steps.length;
      await mount({
        mode: LearnMode.instructor,
        procedureId: 'check-coolant',
        stepIndex: steps - 2,
      });
      await press('instructor-next');
      expect(node('instructor-next').props.accessibilityLabel).toBe(
        'Finish procedure',
      );
      expect(await loadProgress()).toMatchObject({ stepIndex: steps - 1 });
      const speech = deferred<void>();
      jest.mocked(output.speak).mockReturnValueOnce(speech.promise);
      await ask('repeat');
      expect(text('instructor-status')).toBe('Speaking');
      const stopped = jest.mocked(output.stop).mock.calls.length;
      await press('instructor-next');
      expect(jest.mocked(output.stop).mock.calls.length).toBeGreaterThan(
        stopped,
      );
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
      expect(await loadProgress()).toBeNull();
      await act(async () => speech.resolve());
    });

    test('requests voice access on entering Instructor, before holding the mic', async () => {
      await mount();
      expect(input.requestPermission).not.toHaveBeenCalled();
      await press('instructor-toggle');
      expect(input.requestPermission).toHaveBeenCalledTimes(1);
      expect(input.start).not.toHaveBeenCalled();
      await startHold();
      expect(input.requestPermission).toHaveBeenCalledTimes(1);
      expect(input.start).toHaveBeenCalledTimes(1);
    });

    test('waits for voice access without showing a listening state', async () => {
      const permission = deferred<'granted'>();
      jest
        .mocked(input.requestPermission)
        .mockReturnValueOnce(permission.promise);
      await mount({ mode: LearnMode.instructor });
      expect(input.requestPermission).toHaveBeenCalledTimes(1);
      expect(panel().props.voice.state).toBe('idle');
      expect(node('instructor-talk').props.accessibilityState.disabled).toBe(
        true,
      );
      await act(async () => permission.resolve('granted'));
      expect(node('instructor-talk').props.accessibilityState.disabled).toBe(
        false,
      );
    });

    test.each(['instructor-grabber', 'instructor-header'])(
      '%s toggles a compact bar with an expanded accessibility state',
      async control => {
        await mount({ mode: LearnMode.instructor });
        expect(node(control).props.accessibilityState).toEqual({
          expanded: true,
        });
        expect(node(control).props.accessibilityLabel).toBe(
          'Minimize instructor',
        );
        await press(control);
        expect(panel().props.mode).toBe(PanelMode.minimized);
        expect(node(control).props.accessibilityState).toEqual({
          expanded: false,
        });
        expect(node(control).props.accessibilityLabel).toBe(
          'Expand instructor',
        );
        expect(has('instructor-question')).toBe(false);
        expect(has('instructor-reply')).toBe(false);
        expect(has('instructor-preview')).toBe(true);
        expect(node('instructor-preview').props.numberOfLines).toBe(1);
        expect(text('instructor-preview')).toBe(
          procedure('tour').steps[0].text,
        );
        expect(renderer.root.findByType(InstructorTalk).props.size).toBe(44);
        await press(control);
        expect(panel().props.mode).toBe(PanelMode.expanded);
        expect(renderer.root.findByType(InstructorTalk).props.size).toBe(56);
        expect(has('instructor-reply')).toBe(true);
      },
    );

    test('minimizing dismisses the keyboard and restores the voice row on expansion', async () => {
      await mount({ mode: LearnMode.instructor });
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      await press('instructor-keyboard');
      expect(has('instructor-input')).toBe(true);
      await press('instructor-grabber');
      expect(dismiss).toHaveBeenCalled();
      expect(has('instructor-input')).toBe(false);
      await press('instructor-header');
      expect(has('instructor-talk')).toBe(true);
      expect(has('instructor-input')).toBe(false);
    });

    test('the compact mic listens, shows a meter and asks without expanding', async () => {
      await mount({ mode: LearnMode.instructor });
      await press('instructor-header');
      const time = clock();
      await startHold();
      expect(text('instructor-status')).toBe('Listening');
      expect(has('instructor-meter')).toBe(true);
      await act(async () =>
        jest.mocked(input.start).mock.calls[0][2]('Where is the battery?'),
      );
      expect(text('instructor-preview')).toBe('Where is the battery?');
      jest.mocked(input.finish).mockResolvedValueOnce('Where is the battery?');
      time.mockReturnValue(1000 + MIN_HOLD_MS);
      await releaseHold();
      expect(debug().getState().selectedPart).toBe('battery');
      expect(panel().props.mode).toBe(PanelMode.minimized);
      expect(text('instructor-preview')).toBe(
        pack.parts.find(part => part.id === 'battery')!.summary,
      );
    });

    test('streaming and finished answers highlight parts but never expand the compact bar', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      const answer = deferred<string>();
      jest.mocked(model.respond).mockReturnValueOnce(answer.promise);
      await mount({ mode: LearnMode.instructor });
      await press('instructor-grabber');
      await ask('Explain the battery');
      expect(panel().props.mode).toBe(PanelMode.minimized);
      expect(text('instructor-status')).toBe('Thinking');
      await act(async () =>
        jest.mocked(model.respond).mock.calls[0][2](modelReply('It supplies')),
      );
      expect(debug().getState().selectedPart).toBe('battery');
      expect(text('instructor-preview')).toBe('It supplies');
      await act(async () => {
        answer.resolve(modelReply());
      });
      expect(text('instructor-preview')).toBe('It supplies the starter.');
      expect(panel().props.mode).toBe(PanelMode.minimized);
      expect(has('instructor-reply')).toBe(false);
    });

    test('compact mode lasts for this viewer session but is not persisted', async () => {
      await mount({ mode: LearnMode.instructor });
      await press('instructor-header');
      await press('instructor-toggle');
      await press('instructor-toggle');
      expect(panel().props.mode).toBe(PanelMode.minimized);
      await act(async () => renderer.unmount());
      await mount({ mode: LearnMode.instructor });
      expect(panel().props.mode).toBe(PanelMode.expanded);
    });

    test('the vertical pan follows the finger and snaps by distance and velocity', async () => {
      await mount({ mode: LearnMode.instructor });
      const pan = () => jest.mocked(usePanGesture).mock.calls.at(-1)![0]!;
      const drag = async (
        translationY: number,
        velocityY = 0,
        canceled = false,
      ) =>
        act(async () => {
          emit(pan().onActivate, {});
          emit(pan().onUpdate, { translationY });
          emit(pan().onDeactivate, { translationY, velocityY, canceled });
        });
      await drag(PanelPan.distance);
      expect(panel().props.mode).toBe(PanelMode.minimized);
      await drag(0, -PanelPan.velocity);
      expect(panel().props.mode).toBe(PanelMode.expanded);
      await drag(PanelPan.distance, 0, true);
      expect(panel().props.mode).toBe(PanelMode.expanded);
      expect(withSpring).toHaveBeenCalledWith(0, Motion.spring);
    });

    test('viewport resizing reframes once at layout completion and keeps the current part', async () => {
      await mount({ mode: LearnMode.instructor });
      await attach();
      await ask('Where is the battery?');
      const calls = view.frame.mock.calls.length;
      await press('instructor-header');
      await layout({ width: 300, height: 440 });
      await layout({ width: 300, height: 480 });
      expect(view.frame).toHaveBeenCalledTimes(calls);
      await settleViewport(false);
      expect(view.frame).toHaveBeenCalledTimes(calls);
      await settleViewport();
      expect(view.frame).toHaveBeenCalledTimes(calls + 1);
      expect(view.frame).toHaveBeenLastCalledWith(lastFraming(), FRAME_SECONDS);
      await settleViewport();
      expect(view.frame).toHaveBeenCalledTimes(calls + 1);
    });

    test('microphone levels update the shared meter without a React render and ignore late levels', async () => {
      await mount({ mode: LearnMode.instructor });
      await startHold();
      const voice = panel().props.voice;
      expect(has('instructor-meter-bar-4')).toBe(true);
      expect(
        StyleSheet.flatten(node('instructor-meter-bar-0').props.style),
      ).toMatchObject({ width: 2, height: 4, borderRadius: 0 });
      await act(async () => voiceEvents.emitLevel(0.8));
      expect(panel().props.voice).toBe(voice);
      expect(voice.level.value).toBe(0.8);
      expect(withTiming).toHaveBeenCalledWith(
        0.8,
        expect.objectContaining({ duration: Motion.levelSmoothing }),
      );
      await press('instructor-keyboard');
      await act(async () => voiceEvents.emitLevel(1));
      expect(panel().props.voice.level.value).toBe(0);
    });

    test('the talk button uses the shared spring for press and release', async () => {
      await mount({ mode: LearnMode.instructor });
      await startHold();
      expect(withSpring).toHaveBeenCalledWith(1, Motion.spring);
      await releaseHold();
      expect(withSpring).toHaveBeenCalledWith(0, Motion.spring);
    });

    test('each spoken word colors the reply and kicks the meter envelope', async () => {
      const speech = deferred<void>();
      await mount({ mode: LearnMode.instructor });
      jest.mocked(output.speak).mockClear();
      jest.mocked(output.speak).mockReturnValueOnce(speech.promise);
      await ask('Where is the battery?');
      const reply = pack.parts.find(part => part.id === 'battery')!.summary;
      const location = reply.indexOf('battery');
      await act(async () => voiceEvents.emitWord(location, 'battery'.length));
      expect(text('instructor-reply-current')).toBe('battery');
      expect(node('instructor-reply-current').props.style.color).toBe(
        Color.accent,
      );
      expect(node('instructor-reply-spoken').props.style.color).toBe(
        Color.text,
      );
      expect(node('instructor-reply-remaining').props.style.color).toBe(
        Color.muted,
      );
      expect(withSequence).toHaveBeenCalled();
      expect(withTiming).toHaveBeenCalledWith(
        0.7,
        expect.objectContaining({ duration: Motion.wordAttack }),
      );
      expect(withTiming).toHaveBeenCalledWith(
        0,
        expect.objectContaining({ duration: Motion.wordDecay }),
      );
      await act(async () => {
        speech.resolve();
      });
      expect(text('instructor-reply')).toBe(reply);
      expect(has('instructor-reply-current')).toBe(false);
      expect(panel().props.voice.word).toBeNull();
      await act(async () => voiceEvents.emitWord(location, 'battery'.length));
      expect(panel().props.voice.word).toBeNull();
    });

    test('caution karaoke follows its own word ranges and ignores late reply words', async () => {
      const replyDone = deferred<void>();
      const cautionDone = deferred<void>();
      await mount({
        mode: LearnMode.instructor,
        procedureId: 'check-coolant',
        stepIndex: 0,
      });
      jest.mocked(output.speak).mockClear();
      jest
        .mocked(output.speak)
        .mockReturnValueOnce(replyDone.promise)
        .mockReturnValueOnce(cautionDone.promise);
      await ask('repeat');
      const lateReplyWord = jest.mocked(output.speak).mock.calls[0][2];
      await act(async () => voiceEvents.emitWord(0, 4));
      expect(text('instructor-reply-current')).toBe('Park');
      await act(async () => {
        replyDone.resolve();
      });
      expect(has('instructor-reply-current')).toBe(false);
      await act(async () => voiceEvents.emitWord(0, 3));
      expect(text('instructor-caution-text-current')).toBe('Hot');
      await act(async () => lateReplyWord(5, 2));
      expect(text('instructor-caution-text-current')).toBe('Hot');
      await press('instructor-stop');
      expect(has('instructor-caution-text-current')).toBe(false);
      expect(text('instructor-caution-text')).toBe(
        procedure('check-coolant').steps[0].caution,
      );
      await act(async () => {
        cautionDone.resolve();
      });
    });

    test('reduced motion has no scaling, translation, layout movement or scan loop', async () => {
      jest.mocked(useReducedMotion).mockReturnValue(true);
      jest.mocked(model.availability).mockReturnValue('available');
      const answer = deferred<string>();
      jest.mocked(model.respond).mockReturnValueOnce(answer.promise);
      await mount({ mode: LearnMode.instructor });
      expect(node('instructor-panel').props.layout).toBeUndefined();
      expect(node('viewer-viewport').props.layout).toBeUndefined();
      await startHold();
      expect(
        StyleSheet.flatten(node('instructor-talk-motion').props.style)
          .transform,
      ).toBeUndefined();
      expect(
        StyleSheet.flatten(node('instructor-talk-ring').props.style).transform,
      ).toEqual([]);
      expect(withSpring).not.toHaveBeenCalled();
      await act(async () => voiceEvents.emitLevel(0.6));
      expect(panel().props.voice.level.value).toBe(0.6);
      await ask('Explain the battery');
      expect(has('instructor-scan-static')).toBe(true);
      expect(
        StyleSheet.flatten(node('instructor-scan-static').props.style).height,
      ).toBe(2);
      expect(has('instructor-scan-sweep')).toBe(false);
      expect(withRepeat).not.toHaveBeenCalled();
      await press('instructor-header');
      expect(panel().props.mode).toBe(PanelMode.minimized);
      expect(
        StyleSheet.flatten(node('instructor-panel').props.style).transform,
      ).toBeUndefined();
    });

    test('reduced motion still pulses the word meter and reframes the compact viewport', async () => {
      jest.mocked(useReducedMotion).mockReturnValue(true);
      const speech = deferred<void>();
      await mount({ mode: LearnMode.instructor });
      jest.mocked(output.speak).mockClear();
      jest.mocked(output.speak).mockReturnValueOnce(speech.promise);
      await attach();
      await ask('next');
      await act(async () => voiceEvents.emitWord(0, 3));
      expect(has('instructor-meter')).toBe(true);
      expect(withSequence).toHaveBeenCalled();
      await press('instructor-header');
      const calls = view.frame.mock.calls.length;
      await layout({ width: 300, height: 480 });
      expect(view.frame).toHaveBeenCalledTimes(calls + 1);
      await act(async () => {
        speech.resolve();
      });
    });

    test('holds to listen with hints, displays live words and releases to ask', async () => {
      await mount({ mode: LearnMode.instructor });
      expect(has('instructor-caption')).toBe(false);
      const time = clock();
      await startHold();
      expect(output.stop).toHaveBeenCalled();
      expect(input.start).toHaveBeenCalledWith(
        VOICE_LOCALE,
        recognitionHintsFor(pack),
        expect.any(Function),
        expect.any(Function),
      );
      expect(
        jest.mocked(output.stop).mock.invocationCallOrder.at(-1)!,
      ).toBeLessThan(jest.mocked(input.start).mock.invocationCallOrder[0]);
      expect(text('instructor-status')).toBe('Listening');
      expect(has('instructor-caption')).toBe(false);
      expect(has('instructor-question')).toBe(false);
      const partial = jest.mocked(input.start).mock.calls[0][2];
      await act(async () => partial('Where is the battery?'));
      expect(text('instructor-question')).toBe('Where is the battery?');
      expect(node('instructor-question').props.accessibilityLabel).toContain(
        'Provisional transcript',
      );
      jest.mocked(input.finish).mockResolvedValueOnce('Where is the battery?');
      time.mockReturnValue(1000 + MIN_HOLD_MS);
      await releaseHold();
      expect(has('instructor-caption')).toBe(false);
      expect(debug().getState().selectedPart).toBe('battery');
      expect(text('instructor-question')).toBe('Where is the battery?');
      expect(output.speak).toHaveBeenCalledWith(
        pack.parts.find(part => part.id === 'battery')!.summary,
        VOICE_LOCALE,
        expect.any(Function),
      );
    });

    test('holding the mic keeps the panel height while the transcript grows', async () => {
      await mount({ mode: LearnMode.instructor });
      const height = () =>
        StyleSheet.flatten(node('instructor-panel').props.style).height;
      await act(async () =>
        node('instructor-panel').props.onLayout({
          nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 236 } },
        }),
      );
      expect(height()).toBeUndefined();
      const time = clock();
      await startHold();
      expect(height()).toBe(236);
      // The step text stays in place, dimmed, while the transcript grows above it.
      const stale = () =>
        node('instructor-answer').props.accessibilityState.busy;
      const stepText = text('instructor-reply');
      expect(stale()).toBe(true);
      const partial = jest.mocked(input.start).mock.calls[0][2];
      await act(async () =>
        partial('Where is the battery and how do I check its charge?'),
      );
      expect(height()).toBe(236);
      expect(text('instructor-reply')).toBe(stepText);
      expect(text('instructor-question')).toBe(
        'Where is the battery and how do I check its charge?',
      );
      jest.mocked(input.finish).mockResolvedValueOnce('Where is the battery?');
      time.mockReturnValue(1000 + MIN_HOLD_MS);
      await releaseHold();
      expect(height()).toBeUndefined();
      expect(stale()).toBe(false);
      expect(text('instructor-question')).toBe('Where is the battery?');
    });

    test('the last answer and the panel height stay until the new answer has words', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      const answer = deferred<string>();
      jest.mocked(model.respond).mockReturnValueOnce(answer.promise);
      await mount({ mode: LearnMode.instructor });
      const height = () =>
        StyleSheet.flatten(node('instructor-panel').props.style).height;
      await act(async () =>
        node('instructor-panel').props.onLayout({
          nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 236 } },
        }),
      );
      const stepText = text('instructor-reply');
      const time = clock();
      await startHold();
      jest.mocked(input.finish).mockResolvedValueOnce('Explain the battery');
      time.mockReturnValue(1000 + MIN_HOLD_MS);
      await releaseHold();
      expect(text('instructor-status')).toBe('Thinking');
      expect(text('instructor-question')).toBe('Explain the battery');
      expect(text('instructor-reply')).toBe(stepText);
      expect(node('instructor-answer').props.accessibilityState.busy).toBe(
        true,
      );
      expect(height()).toBe(236);
      const partial = jest.mocked(model.respond).mock.calls[0][2];
      await act(async () => partial(modelReply('It supplies')));
      expect(text('instructor-reply')).toBe('It supplies');
      expect(node('instructor-answer').props.accessibilityState.busy).toBe(
        false,
      );
      expect(height()).toBeUndefined();
    });

    test('a short hold gives a hint without finishing or asking', async () => {
      await mount({ mode: LearnMode.instructor });
      jest.mocked(output.speak).mockClear();
      const time = clock();
      await startHold();
      time.mockReturnValue(1000 + MIN_HOLD_MS - 1);
      await releaseHold();
      expect(input.finish).not.toHaveBeenCalled();
      expect(text('instructor-hint')).toBe(VoiceHint.shortHold);
      expect(has('instructor-question')).toBe(false);
      expect(output.speak).not.toHaveBeenCalled();
    });

    test('an empty finished transcript gives a hint', async () => {
      await mount({ mode: LearnMode.instructor });
      const time = clock();
      await startHold();
      time.mockReturnValue(1000 + MIN_HOLD_MS);
      jest.mocked(input.finish).mockResolvedValueOnce('   ');
      await releaseHold();
      expect(text('instructor-hint')).toBe(VoiceHint.empty);
      expect(has('instructor-question')).toBe(false);
    });

    test.each(['denied', 'restricted'] as const)(
      '%s permission gives a reason and leaves typing available',
      async permission => {
        jest.mocked(input.requestPermission).mockResolvedValueOnce(permission);
        await mount({ mode: LearnMode.instructor });
        await startHold();
        expect(input.start).not.toHaveBeenCalled();
        expect(text('instructor-hint')).toBe(VoiceHint.permission);
        await press('instructor-keyboard');
        expect(has('instructor-input')).toBe(true);
        await act(async () =>
          node('instructor-input').props.onChangeText('next'),
        );
        await press('instructor-send');
        expect(debug().getState().stepIndex).toBe(1);
      },
    );

    test.each(['onDeviceUnsupported', 'unavailable'] as const)(
      '%s recognition gives a reason and keeps typing',
      async availability => {
        jest.mocked(input.availability).mockReturnValue(availability);
        await mount({ mode: LearnMode.instructor });
        await startHold();
        expect(input.start).not.toHaveBeenCalled();
        expect(text('instructor-hint')).toBe(VoiceHint.unavailable);
        await press('instructor-keyboard');
        expect(has('instructor-input')).toBe(true);
      },
    );

    test('recognition errors give a hint and recover', async () => {
      jest.mocked(input.start).mockRejectedValueOnce(new Error('audio busy'));
      await mount({ mode: LearnMode.instructor });
      await startHold();
      expect(text('instructor-hint')).toBe(VoiceHint.failed);
      const time = clock();
      await startHold();
      jest.mocked(input.finish).mockRejectedValueOnce(new Error('lost audio'));
      time.mockReturnValue(1000 + MIN_HOLD_MS);
      await releaseHold();
      expect(text('instructor-hint')).toBe(VoiceHint.failed);
    });

    test('release while recognition starts is remembered and submitted once', async () => {
      const ready = deferred<void>();
      jest.mocked(input.start).mockReturnValueOnce(ready.promise);
      jest.mocked(input.finish).mockResolvedValueOnce('Where is the battery?');
      await mount({ mode: LearnMode.instructor });
      const time = clock();
      await act(async () => {
        node('instructor-talk').props.onPressIn();
      });
      time.mockReturnValue(1000 + MIN_HOLD_MS);
      await releaseHold();
      expect(input.finish).not.toHaveBeenCalled();
      await act(async () => {
        ready.resolve();
      });
      await releaseHold();
      expect(input.finish).toHaveBeenCalledTimes(1);
      expect(debug().getState().selectedPart).toBe('battery');
    });

    test('a short hold during permission does not start listening later', async () => {
      const permission = deferred<'granted'>();
      jest
        .mocked(input.requestPermission)
        .mockReturnValueOnce(permission.promise);
      await mount({ mode: LearnMode.instructor });
      clock();
      await act(async () => {
        node('instructor-talk').props.onPressIn();
      });
      await releaseHold();
      await act(async () => {
        permission.resolve('granted');
      });
      expect(input.start).not.toHaveBeenCalled();
      expect(text('instructor-hint')).toBe(VoiceHint.shortHold);
    });

    test('keyboard and mic buttons swap input rows', async () => {
      await mount({ mode: LearnMode.instructor });
      expect(has('instructor-talk')).toBe(true);
      expect(has('instructor-input')).toBe(false);
      await press('instructor-keyboard');
      expect(has('instructor-input')).toBe(true);
      expect(has('instructor-talk')).toBe(false);
      await press('instructor-mic');
      expect(has('instructor-talk')).toBe(true);
      expect(has('instructor-input')).toBe(false);
    });

    test('a spoken follow-up retains the previous question and reply', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      jest.mocked(model.respond).mockResolvedValue(modelReply());
      await mount({ mode: LearnMode.instructor });
      await ask('Explain the battery');
      const time = clock();
      await startHold();
      jest.mocked(input.finish).mockResolvedValueOnce('What does it do?');
      time.mockReturnValue(1000 + MIN_HOLD_MS);
      await releaseHold();
      const prompt = jest.mocked(model.respond).mock.calls[1][1];
      expect(prompt).toMatch(/^Part: Battery\n/);
      expect(prompt).toContain(
        [
          'Earlier question: Explain the battery',
          'Earlier answer: It supplies the starter.',
          'Question: What does it do?',
        ].join('\n'),
      );
    });

    test('prewarms in instructor mode and keeps commands instant', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      await mount({ mode: LearnMode.instructor });
      expect(model.prewarm).toHaveBeenCalledWith(onDeviceInstructions(pack));
      await ask('next');
      expect(model.respond).not.toHaveBeenCalled();
      expect(debug().getState().stepIndex).toBe(1);
      expect(text('instructor-reply')).toBe(procedure('tour').steps[1].text);
    });

    test('does not prewarm before opening the instructor', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      await mount();
      expect(model.prewarm).not.toHaveBeenCalled();
      await press('instructor-toggle');
      expect(model.prewarm).toHaveBeenCalledWith(onDeviceInstructions(pack));
    });

    test('speaks a model reply once without appending the current step caution', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      const reply = 'Keep sparks and metal tools away from the battery.';
      jest.mocked(model.respond).mockResolvedValueOnce(reply);
      await mount({
        mode: LearnMode.instructor,
        procedureId: 'check-coolant',
        stepIndex: 0,
      });
      jest.mocked(output.speak).mockClear();
      await ask('Explain the battery safety');
      expect(text('instructor-reply')).toBe(reply);
      expect(has('caution')).toBe(false);
      expect(jest.mocked(output.speak).mock.calls).toEqual([
        [reply, VOICE_LOCALE, expect.any(Function)],
      ]);
    });

    test('streams the reply and highlights its part once the first words appear', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      const answer = deferred<string>();
      jest.mocked(model.respond).mockReturnValueOnce(answer.promise);
      await mount({ mode: LearnMode.instructor });
      jest.mocked(output.speak).mockClear();
      const stepText = text('instructor-reply');
      await ask('Explain the battery');
      expect(text('instructor-status')).toBe('Thinking');
      expect(text('instructor-reply')).toBe(stepText);
      expect(
        StyleSheet.flatten(node('instructor-scan-sweep').props.style).height,
      ).toBe(2);
      const partial = jest.mocked(model.respond).mock.calls[0][2];
      await act(async () => partial('  '));
      expect(debug().getState().selectedPart).toBeNull();
      expect(text('instructor-reply')).toBe(stepText);
      await act(async () => partial('It **supplies**'));
      expect(debug().getState().selectedPart).toBe('battery');
      expect(text('instructor-reply')).toBe('It supplies');
      expect(output.speak).not.toHaveBeenCalled();
      await act(async () => {
        answer.resolve('It supplies the starter.');
      });
      expect(text('instructor-reply')).toBe('It supplies the starter.');
      expect(debug().getState().selectedPart).toBe('battery');
      expect(output.speak).toHaveBeenCalledWith(
        'It supplies the starter.',
        VOICE_LOCALE,
        expect.any(Function),
      );
    });

    test('follow-up includes the previous question, reply and selected part', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      jest.mocked(model.respond).mockResolvedValue(modelReply());
      await mount({ mode: LearnMode.instructor });
      await ask('Explain the battery');
      await ask('What does it do?');
      const prompt = jest.mocked(model.respond).mock.calls[1][1];
      expect(prompt).toMatch(/^Part: Battery\n/);
      expect(prompt).toContain(
        [
          'Earlier question: Explain the battery',
          'Earlier answer: It supplies the starter.',
          'Question: What does it do?',
        ].join('\n'),
      );
    });

    test.each(['new question', 'step change', 'panel close', 'stop'])(
      'a late model reply cannot land after %s',
      async change => {
        jest.mocked(model.availability).mockReturnValue('available');
        const answer = deferred<string>();
        jest.mocked(model.respond).mockReturnValueOnce(answer.promise);
        await mount({ mode: LearnMode.instructor });
        await ask('Explain the battery');
        const partial = jest.mocked(model.respond).mock.calls[0][2];
        if (change === 'new question') {
          await ask('next');
        } else if (change === 'step change') {
          await press('instructor-next');
        } else {
          await press(
            change === 'stop' ? 'instructor-stop' : 'instructor-toggle',
          );
        }
        const state = debug().getState();
        const spokenCount = jest.mocked(output.speak).mock.calls.length;
        await act(async () => {
          partial(modelReply('Late partial'));
          answer.resolve(modelReply('Late final'));
        });
        expect(debug().getState()).toBe(state);
        expect(jest.mocked(output.speak).mock.calls.length).toBe(spokenCount);
        expect(model.cancel).toHaveBeenCalled();
        if (has('instructor-reply')) {
          expect(text('instructor-reply')).not.toBe('Late final');
        }
      },
    );

    test('unmount cancels model and speech and ignores their late results', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      const answer = deferred<string>();
      jest.mocked(model.respond).mockReturnValueOnce(answer.promise);
      await mount({ mode: LearnMode.instructor });
      jest.mocked(output.speak).mockClear();
      await ask('Explain the battery');
      const partial = jest.mocked(model.respond).mock.calls[0][2];
      await act(async () => renderer.unmount());
      await act(async () => {
        partial(modelReply());
        answer.resolve(modelReply());
      });
      expect(model.cancel).toHaveBeenCalled();
      expect(output.stop).toHaveBeenCalled();
      expect(input.cancel).toHaveBeenCalled();
      expect(output.speak).not.toHaveBeenCalled();
    });

    test('model errors restore the script even after a provisional highlight', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      const answer = deferred<string>();
      jest.mocked(model.respond).mockReturnValueOnce(answer.promise);
      await mount({ mode: LearnMode.instructor });
      // Its words fit the steering notes, but the script names no part for it.
      await ask('What gets hot when I drive?');
      await act(async () =>
        jest.mocked(model.respond).mock.calls[0][2](modelReply('Provisional')),
      );
      expect(debug().getState().selectedPart).toBe('power-steering-reservoir');
      await act(async () => {
        answer.reject(new Error('model failed'));
      });
      expect(debug().getState().selectedPart).toBeNull();
      expect(text('instructor-reply')).toContain('Ask for a part or a check');
    });

    test('reads exact step text then caution, and stop prevents a delayed caution', async () => {
      await mount({
        mode: LearnMode.instructor,
        procedureId: 'check-coolant',
        stepIndex: 0,
      });
      jest.mocked(output.speak).mockClear();
      await ask('repeat');
      const first = procedure('check-coolant').steps[0];
      expect(jest.mocked(output.speak).mock.calls).toEqual([
        [first.text, VOICE_LOCALE, expect.any(Function)],
        [first.caution, VOICE_LOCALE, expect.any(Function)],
      ]);
      const speech = deferred<void>();
      jest.mocked(output.speak).mockReturnValueOnce(speech.promise);
      await ask('repeat');
      expect(text('instructor-status')).toBe('Speaking');
      await press('instructor-stop');
      expect(text('instructor-reply')).toBe(first.text);
      const calls = jest.mocked(output.speak).mock.calls.length;
      await act(async () => {
        speech.resolve();
      });
      expect(jest.mocked(output.speak).mock.calls.length).toBe(calls);
      expect(has('instructor-stop')).toBe(false);
    });

    test.each(['talk', 'close', 'step', 'unmount'])(
      '%s stops speech and guards delayed completion',
      async change => {
        const speech = deferred<void>();
        await mount({ mode: LearnMode.instructor });
        jest.mocked(output.speak).mockClear();
        jest.mocked(output.speak).mockReturnValueOnce(speech.promise);
        await ask('next');
        expect(text('instructor-status')).toBe('Speaking');
        const stopped = jest.mocked(output.stop).mock.calls.length;
        if (change === 'talk') {
          await startHold();
        } else if (change === 'close') {
          await press('instructor-toggle');
        } else if (change === 'step') {
          await press('instructor-next');
        } else {
          await act(async () => renderer.unmount());
        }
        expect(jest.mocked(output.stop).mock.calls.length).toBeGreaterThan(
          stopped,
        );
        await act(async () => {
          speech.resolve();
        });
        if (change === 'talk') {
          expect(text('instructor-status')).toBe('Listening');
        }
      },
    );

    test('late recognition callbacks and finished transcripts cannot replace a newer question', async () => {
      const finished = deferred<string>();
      jest.mocked(input.finish).mockReturnValueOnce(finished.promise);
      await mount({ mode: LearnMode.instructor });
      const time = clock();
      await startHold();
      const partial = jest.mocked(input.start).mock.calls[0][2];
      time.mockReturnValue(1000 + MIN_HOLD_MS);
      await releaseHold();
      await ask('next');
      await act(async () => {
        partial('old words');
        finished.resolve('Where is the battery?');
      });
      expect(text('instructor-question')).toBe('next');
      expect(debug().getState().selectedPart).toBeNull();
      expect(debug().getState().stepIndex).toBe(1);
    });

    test('speech output errors leave the written reply visible', async () => {
      jest
        .mocked(output.speak)
        .mockRejectedValueOnce(new Error('voice unavailable'));
      await mount({ mode: LearnMode.instructor });
      await ask('next');
      expect(text('instructor-hint')).toBe(VoiceHint.output);
      expect(text('instructor-reply')).toBe(procedure('tour').steps[1].text);
    });

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
      expect(text('step-counter')).toBe('Step 01 / 05');
    });

    test('a typed question shows the part and the answer', async () => {
      await mount({ mode: LearnMode.instructor });
      await press('instructor-keyboard');
      await act(() =>
        node('instructor-input').props.onChangeText('Where is the battery?'),
      );
      expect(node('instructor-send').props.accessibilityState).toEqual({
        disabled: false,
      });
      await act(async () => node('instructor-input').props.onSubmitEditing());
      const battery = pack.parts.find(part => part.id === 'battery')!;
      expect(debug().getState().selectedPart).toBe('battery');
      expect(text('instructor-question')).toBe('Where is the battery?');
      expect(text('instructor-reply')).toBe(battery.summary);
      expect(node('instructor-input').props.value).toBe('');
      expect(native().props.highlight).toEqual([battery.label]);
    });

    test('a typed command moves the procedure on and the buttons agree', async () => {
      await mount({
        procedureId: 'check-coolant',
        stepIndex: 1,
        mode: LearnMode.instructor,
      });
      await press('instructor-keyboard');
      await act(() => node('instructor-input').props.onChangeText('Next step'));
      await act(async () => node('instructor-input').props.onSubmitEditing());
      expect(debug().getState().stepIndex).toBe(2);
      expect(text('instructor-reply')).toBe(
        procedure('check-coolant').steps[2].text,
      );
      await press('instructor-toggle');
      expect(text('step-counter')).toBe('Step 03 / 05');
    });

    test('debug ask drives the same path for end-to-end checks', async () => {
      await mount({ mode: LearnMode.instructor });
      await act(async () => debug().ask('how do I check the brake fluid'));
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
