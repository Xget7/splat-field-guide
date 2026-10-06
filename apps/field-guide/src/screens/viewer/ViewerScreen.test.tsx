import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Dimensions, Keyboard, Modal, StyleSheet } from 'react-native';
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
  usePanGesture,
  usePinchGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import type { SplatViewSpec } from 'react-native-splat';
import { fixturePack } from '../../testing/fixturePack';
import { catalogFor } from '../../pack/catalog';
import { CatalogProvider } from '../../navigation/CatalogContext';
import { highlightFor } from '../../guide/derive';
import type { ProcedureId } from '../../pack/pack';
import { SessionEventType } from '../../guide/session';
import { TOUR_ID } from '../../guide/tour';
import {
  LearnMode,
  Route,
  type RootStackParamList,
  type ScreenProps,
} from '../../navigation/routes';
import { bundledPack } from '../../pack/bundledPack';
import { continueRowFor } from '../library/library';
import { loadProgress } from '../../navigation/progressStorage';
import { ViewerScreen, type FieldGuideDebug } from './ViewerScreen';
import { onDeviceInstructions } from '../../instructor/models/onDeviceModel';
import { Color, Motion } from '../../ui/theme';
import { InstructorPanel } from './instructor/InstructorPanel';
import { PanelMode, PanelPan } from './instructor/panelMotion';
import {
  VoiceHint,
  VOICE_LOCALE,
} from '../../instructor/voice/useInstructorVoice';
import { recognitionHintsFor } from '../../instructor/voice/recognitionHints';

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
// About the step on screen, so it names no other part to move to.
const PUSH_IN_QUESTION = 'Why does this step matter?';
// Longer than a mid-phrase turn is held for once the voice pauses.
const PAST_HOLD_MS = 2000;
const IPAD_WINDOW = { width: 1366, height: 1024, scale: 2, fontScale: 1 };

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
    project: jest.fn<number, [ArrayBuffer, ArrayBuffer]>(() => 0),
  };
  const mount = async (
    params: Partial<RootStackParamList[typeof Route.viewer]> = {},
    entries = catalog,
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
        <CatalogProvider catalog={entries}>
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
    await act(() => native().props.onReady());
  };
  const home = {
    azimuth: (pack.camera.home.azimuth * Math.PI) / 180,
    elevation: (pack.camera.home.elevation * Math.PI) / 180,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    view.project.mockReset().mockReturnValue(0);
    jest.mocked(useReducedMotion).mockReturnValue(false);
    jest.mocked(model.availability).mockReturnValue('unavailable');
    jest.mocked(model.respond).mockReset();
    jest
      .mocked(input.requestPermission)
      .mockReset()
      .mockResolvedValue('granted');
    jest.mocked(input.prepare).mockReset().mockResolvedValue('available');
    jest.mocked(input.listen).mockReset().mockResolvedValue();
    jest.mocked(output.speak).mockReset().mockResolvedValue();
    await AsyncStorage.clear();
  });
  afterEach(async () => {
    await act(() => renderer.unmount());
    jest.useRealTimers();
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
    expect(text('step-counter')).toBe('Step 2 of 5');
    expect(text('step-title')).toBe('Coolant reservoir');
    expect(node('procedure-button').props.accessibilityLabel).toBe(
      'Procedure: Check the coolant level',
    );
    expect(node('step-panel').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 46 })]),
    );
    expect(native().props.highlight).toEqual(highlightFor(getState(), pack));
  });

  test('on an iPad the steps list beside the splat and open any step', async () => {
    const phone = Dimensions.get('window');
    Dimensions.set({ window: IPAD_WINDOW, screen: IPAD_WINDOW });
    try {
      await mount({ procedureId: 'check-coolant', mode: LearnMode.instructor });
      expect(has('viewer-sidebar')).toBe(true);
      expect(has('instructor-grabber')).toBe(false);
      expect(node('step-row-0').props.accessibilityState).toEqual({
        selected: true,
      });
      await press('step-row-3');
      expect(debug().getState().stepIndex).toBe(3);
      expect(node('step-row-3').props.accessibilityState).toEqual({
        selected: true,
      });
      // The current step is whole in the list, so the conversation does not repeat it.
      const step = procedure('check-coolant').steps[3];
      expect(
        [text('step-current-text'), text('step-current-detail')].join(' '),
      ).toBe(step.text);
      expect(has('instructor-reply')).toBe(false);
      expect(has('thread-entry-0')).toBe(false);
      const question = 'What does the coolant reservoir do?';
      await act(async () => debug().ask(question));
      expect(text('instructor-question')).toBe(question);
      jest.mocked(model.availability).mockReturnValue('available');
      jest
        .mocked(model.respond)
        .mockResolvedValueOnce(
          '1. Wait for the engine to cool.\n2. Read the reservoir level.',
        );
      await act(async () => debug().ask('Explain the coolant checks'));
      expect(node('instructor-reply-item-1').props.accessibilityLabel).toBe(
        'Wait for the engine to cool.',
      );
      expect(node('instructor-reply-item-2').props.accessibilityLabel).toBe(
        'Read the reservoir level.',
      );
    } finally {
      await act(async () => Dimensions.set({ window: phone, screen: phone }));
    }
  });

  test('on an iPad, Explore lists the parts to pick, and Guide resumes the step', async () => {
    const phone = Dimensions.get('window');
    Dimensions.set({ window: IPAD_WINDOW, screen: IPAD_WINDOW });
    try {
      await mount({ procedureId: 'check-coolant', mode: LearnMode.instructor });
      await press('step-row-2');
      await press('tool-explore');
      expect(continueRowFor(catalog, await loadProgress())).toMatchObject({
        stepIndex: 2,
      });
      expect(has('step-list')).toBe(false);
      await press('part-row-battery');
      expect(debug().getState()).toEqual({
        procedureId: null,
        stepIndex: 0,
        selectedPart: 'battery',
      });
      // Full view folds the sidebar into buttons over the splat; Guide unfolds it.
      await press('tool-full-view');
      expect(has('viewer-sidebar')).toBe(false);
      expect(has('viewer-dock')).toBe(true);
      await press('tool-guide');
      expect(has('viewer-dock')).toBe(false);
      expect(has('part-list')).toBe(false);
      expect(debug().getState().stepIndex).toBe(2);
      expect(node('step-row-2').props.accessibilityState).toEqual({
        selected: true,
      });
    } finally {
      await act(async () => Dimensions.set({ window: phone, screen: phone }));
    }
  });

  test('frames once laid out without animation, then slides steps from home', async () => {
    await mount();
    await act(() => native().props.hybridRef(view as unknown as SplatViewSpec));
    expect(view.frame).not.toHaveBeenCalled();
    await layout();
    expect(view.frame).not.toHaveBeenCalled();
    await act(() => native().props.onReady());
    expect(view.frame.mock.calls.at(-1)?.[2]).toEqual(home);
    expect(view.frame).toHaveBeenCalledTimes(1);
    await press('step-next');
    expect(view.frame.mock.calls.at(-1)?.[2]).toEqual(home);
    expect(text('step-counter')).toBe('Step 2 of 8');
    await press('step-back');
    expect(text('step-counter')).toBe('Step 1 of 8');
  });

  test('the viewport converts authored camera limits and frames known bounds about their centre', async () => {
    const fixture = fixturePack();
    const authored = {
      ...fixture,
      camera: {
        home: { azimuth: -90, elevation: 45, radius: 1.2 },
        limits: {
          minAzimuth: 90,
          maxAzimuth: 270,
          minElevation: -45,
          maxElevation: 90,
          minRadius: 0.25,
          maxRadius: 2.5,
        },
      },
    };
    await mount({ guideId: authored.packId }, catalogFor(authored));
    expect(native().props.cameraLimits).toEqual({
      minAzimuth: Math.PI / 2,
      maxAzimuth: (3 * Math.PI) / 2,
      minElevation: -Math.PI / 4,
      maxElevation: Math.PI / 2,
      minRadius: 0.25,
      maxRadius: 2.5,
    });
    await attach();
    expect(view.frame).toHaveBeenLastCalledWith(
      { min: { x: -0.5, y: -0.5, z: -0.5 }, max: { x: 1.5, y: 1.5, z: 1.5 } },
      0,
      { azimuth: -Math.PI / 2, elevation: Math.PI / 4 },
    );
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
    expect(view.frame.mock.calls.at(-1)?.[2]).toEqual(home);
  });

  test('selection keeps the orbit direction; repeat and Next restore the step', async () => {
    await mount();
    await attach();
    await act(() =>
      debug().dispatch({ type: SessionEventType.select, partId: 'battery' }),
    );
    expect(text('step-title')).toBe('Battery');
    expect(node('step-repeat').props.accessibilityLabel).toBe('Back to step');
    expect(view.frame.mock.calls.at(-1)).toHaveLength(2);
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
    expect(text('step-counter')).toBe('Step 1 of 5');
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
    expect(view.orbit).toHaveBeenCalledWith(-0.04, -0.02);
    expect(view.dolly).toHaveBeenCalledWith(1.1);
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

  test('a replacement native view waits for its own ready callback', async () => {
    await mount();
    await attach();
    const replacement = { ...view, frame: jest.fn() };
    await act(() =>
      native().props.hybridRef(replacement as unknown as SplatViewSpec),
    );
    expect(replacement.frame).not.toHaveBeenCalled();
    await act(() => native().props.onReady());
    expect(replacement.frame).toHaveBeenCalledTimes(1);
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

  test('projected marks follow the camera and hide a part with a corner behind it', async () => {
    const frames = jest.spyOn(
      jest.requireMock('react-native-reanimated'),
      'useFrameCallback',
    );
    await mount({ procedureId: 'check-power-steering-fluid', stepIndex: 0 });
    await attach();
    await act(() => {
      for (const index of [0, 1]) {
        node(`marker-${index}`).props.onLayout({
          nativeEvent: { layout: { width: 40, height: 12 } },
        });
      }
    });
    let cameraX = 0.25;
    view.project.mockImplementation((_points, out) => {
      const projected = new Float32Array(out);
      projected.fill(NaN);
      for (let corner = 0; corner < 8; corner++) {
        projected[corner * 2] = cameraX;
        projected[corner * 2 + 1] = 0.5;
      }
      return 8;
    });
    const frame = () =>
      emit(frames.mock.calls.at(-1)![0], {
        timestamp: 0,
        timeSincePreviousFrame: null,
        timeSinceFirstFrame: 0,
      });
    await act(frame);
    await press('step-repeat');
    const before = StyleSheet.flatten(node('marker-0').props.style);
    expect(before.opacity).toBe(1);
    expect(StyleSheet.flatten(node('marker-1').props.style).opacity).toBe(0);
    cameraX = 0.75;
    await act(frame);
    await press('step-repeat');
    const after = StyleSheet.flatten(node('marker-0').props.style);
    expect(after.transform[0].translateX - before.transform[0].translateX).toBe(
      150,
    );
    expect(after.transform[1].translateY).toBe(before.transform[1].translateY);
  });

  describe('instructor', () => {
    const ask = async (question: string) =>
      act(async () => debug().ask(question));
    const voiceOn = async () => press('instructor-voice');
    // The callbacks of the latest listening: partial words, a finished turn, the level, the
    // voice starting and pausing, and listening stopping.
    const heard = () => {
      const [, , partial, turn, level, voice, stopped] = jest
        .mocked(input.listen)
        .mock.calls.at(-1)!;
      return { partial, turn, level, voice, stopped };
    };
    const type = async (question: string) => {
      await act(() => node('instructor-input').props.onChangeText(question));
      await act(async () => node('instructor-input').props.onSubmitEditing());
    };
    const panel = () => renderer.root.findByType(InstructorPanel);
    const settleViewport = async (finished = true) =>
      act(async () => node('viewer-viewport').props.layout.callbackV(finished));

    test('the tour talks: it reads the first part on open and each step it moves to', async () => {
      const said = () =>
        jest.mocked(output.speak).mock.calls.map(([spoken]) => spoken);
      await mount({ mode: LearnMode.instructor });
      expect(said()).toEqual([]);
      await voiceOn();
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
      await voiceOn();
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
      expect(text('instructor-step')).toBe('Step 2 of 8');
      expect(text('instructor-reply')).toBe(procedure('tour').steps[1].text);
      expect(has('instructor-question')).toBe(false);
      expect(native().props.highlight).toEqual(
        highlightFor(debug().getState(), pack),
      );
      expect(view.frame.mock.calls.at(-1)?.[2]).toEqual(home);
      expect(await loadProgress()).toMatchObject({ stepIndex: 1 });
      await press('instructor-back');
      expect(debug().getState().stepIndex).toBe(0);
      expect(text('instructor-reply')).toBe(procedure('tour').steps[0].text);
      expect(await loadProgress()).toBeNull();
    });

    test('Next remains available while compact or typing', async () => {
      await mount({ mode: LearnMode.instructor });
      await press('instructor-header');
      await press('instructor-next');
      expect(panel().props.mode).toBe(PanelMode.minimized);
      expect(text('instructor-preview')).toBe(procedure('tour').steps[1].text);
      await press('instructor-header');
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
      await voiceOn();
      const speech = deferred<void>();
      jest.mocked(output.speak).mockReturnValueOnce(speech.promise);
      await ask('repeat');
      expect(text('instructor-voice-status')).toBe('Speaking');
      const stopped = jest.mocked(output.stop).mock.calls.length;
      await press('instructor-next');
      expect(jest.mocked(output.stop).mock.calls.length).toBeGreaterThan(
        stopped,
      );
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
      expect(await loadProgress()).toBeNull();
      await act(async () => speech.resolve());
    });

    test.each([false, true])(
      'spoken stop clears saved progress and the guide set aside during Explore: %s',
      async exploring => {
        await mount({
          mode: LearnMode.instructor,
          procedureId: 'check-coolant',
          stepIndex: 2,
        });
        await voiceOn();
        if (exploring) {
          await press('tool-explore');
        }
        expect(await loadProgress()).toMatchObject({
          procedureId: 'check-coolant',
          stepIndex: 2,
        });
        await act(async () => heard().turn('stop'));
        expect(debug().getState().procedureId).toBeNull();
        expect(await loadProgress()).toBeNull();
        await press('tool-guide');
        expect(debug().getState().procedureId).toBeNull();
        expect(sheet().props.visible).toBe(true);
      },
    );

    test('reading asks for no voice access; voice asks once it is turned on', async () => {
      await mount({ mode: LearnMode.instructor });
      expect(input.requestPermission).not.toHaveBeenCalled();
      expect(output.speak).not.toHaveBeenCalled();
      const permission = deferred<'granted'>();
      jest
        .mocked(input.requestPermission)
        .mockReturnValueOnce(permission.promise);
      await voiceOn();
      expect(input.requestPermission).toHaveBeenCalledTimes(1);
      // The step is said at once; the microphone waits for access.
      expect(output.speak).toHaveBeenCalledTimes(1);
      expect(text('instructor-voice-status')).toBe('Starting');
      expect(input.listen).not.toHaveBeenCalled();
      await act(async () => permission.resolve('granted'));
      expect(input.prepare).toHaveBeenCalledWith(VOICE_LOCALE);
      expect(input.listen).toHaveBeenCalledTimes(1);
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
        await press(control);
        expect(panel().props.mode).toBe(PanelMode.expanded);
        expect(has('instructor-reply')).toBe(true);
      },
    );

    test('minimizing dismisses the keyboard and hides the text field', async () => {
      await mount({ mode: LearnMode.instructor });
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      expect(has('instructor-input')).toBe(true);
      await press('instructor-grabber');
      expect(dismiss).toHaveBeenCalled();
      expect(has('instructor-input')).toBe(false);
      await press('instructor-header');
      expect(has('instructor-input')).toBe(true);
    });

    test('compact voice shows its status and meter with mute and Next', async () => {
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
      await press('instructor-header');
      expect(text('instructor-status')).toBe('Listening');
      expect(has('instructor-meter')).toBe(true);
      await press('instructor-mute');
      expect(text('instructor-status')).toBe('Muted');
      expect(has('instructor-next')).toBe(true);
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

    test('a question about the step pushes in on its part; Next pulls back', async () => {
      await mount({ mode: LearnMode.instructor });
      await attach();
      const before = view.frame.mock.calls.at(-1)![0];
      await ask(PUSH_IN_QUESTION);
      expect(debug().getState().selectedPart).toBeNull();
      const after = view.frame.mock.calls.at(-1)![0];
      expect(after.max.x - after.min.x).toBeLessThan(
        before.max.x - before.min.x,
      );
      expect(view.frame.mock.calls.at(-1)).toHaveLength(2);
      await press('instructor-next');
      expect(view.frame.mock.calls.at(-1)?.[2]).toEqual(home);
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
      expect(view.frame.mock.calls.at(-1)).toHaveLength(2);
      await settleViewport();
      expect(view.frame).toHaveBeenCalledTimes(calls + 1);
    });

    test('microphone levels update the shared meter without a React render and ignore late levels', async () => {
      await mount({ mode: LearnMode.instructor });
      jest.mocked(output.speak).mockReturnValueOnce(new Promise(() => {}));
      await voiceOn();
      const voice = panel().props.voice;
      expect(has('instructor-meter-bar-4')).toBe(true);
      expect(
        StyleSheet.flatten(node('instructor-meter-bar-0').props.style),
      ).toMatchObject({ width: 2, height: 4, borderRadius: 0 });
      // While the instructor talks, the meter follows its words, not the microphone.
      await act(async () => voiceEvents.emitLevel(0.8));
      expect(voice.level.value).toBe(0);
      await press('instructor-stop');
      await act(async () => voiceEvents.emitLevel(0.8));
      expect(panel().props.voice.level.value).toBe(0.8);
      expect(withTiming).toHaveBeenCalledWith(
        0.8,
        expect.objectContaining({ duration: Motion.levelSmoothing }),
      );
      await press('instructor-voice-end');
      await act(async () => voiceEvents.emitLevel(1));
      expect(panel().props.voice.level.value).toBe(0);
    });

    test('each spoken word colors the reply and kicks the meter envelope', async () => {
      const speech = deferred<void>();
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
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
      await voiceOn();
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
      expect(withSpring).not.toHaveBeenCalled();
      await ask('Explain the battery');
      // Open, the dots alone say it is thinking; minimized, the line does.
      expect(has('instructor-thinking')).toBe(true);
      expect(has('instructor-scan-static')).toBe(false);
      await press('instructor-header');
      expect(
        StyleSheet.flatten(node('instructor-scan-static').props.style).height,
      ).toBe(2);
      expect(has('instructor-scan-sweep')).toBe(false);
      expect(withRepeat).not.toHaveBeenCalled();
      expect(panel().props.mode).toBe(PanelMode.minimized);
      expect(
        StyleSheet.flatten(node('instructor-panel').props.style).transform,
      ).toBeUndefined();
    });

    test('reduced motion still pulses the word meter and reframes the compact viewport', async () => {
      jest.mocked(useReducedMotion).mockReturnValue(true);
      const speech = deferred<void>();
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
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

    test('voice asks each spoken turn and stops talking when the user talks over it', async () => {
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
      expect(input.listen).toHaveBeenCalledWith(
        VOICE_LOCALE,
        recognitionHintsFor(pack),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      );
      expect(text('instructor-voice-status')).toBe('Listening');
      expect(has('instructor-input')).toBe(false);
      const cue = () => node('instructor-cue').props.accessibilityLabel;
      expect(cue()).toMatch(/"next"/);
      const [, , partial, turn] = jest.mocked(input.listen).mock.calls[0];
      const speech = deferred<void>();
      jest.mocked(output.speak).mockReturnValueOnce(speech.promise);
      await act(async () => turn('Where is the battery?'));
      expect(debug().getState().selectedPart).toBe('battery');
      const summary = pack.parts.find(part => part.id === 'battery')!.summary;
      expect(output.speak).toHaveBeenCalledWith(
        summary,
        VOICE_LOCALE,
        expect.any(Function),
      );
      // Its own words leaking past echo cancellation do not interrupt it.
      const stops = jest.mocked(output.stop).mock.calls.length;
      await act(async () => partial(summary.split(' ').slice(0, 3).join(' ')));
      expect(output.stop).toHaveBeenCalledTimes(stops);
      await act(async () => partial('Stop'));
      expect(output.stop).toHaveBeenCalledTimes(stops + 1);
      expect(text('instructor-transcript')).toBe('Stop');
      await press('instructor-mute');
      expect(input.cancel).toHaveBeenCalled();
      expect(text('instructor-voice-status')).toBe('Muted');
      expect(cue()).toBe('Muted. Tap the mic to listen again.');
      await act(async () => speech.resolve());
    });

    test('voice drops noise and joins a question said across a pause', async () => {
      jest.useFakeTimers();
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
      await act(async () => heard().turn('.'));
      await act(async () => heard().turn('Uh'));
      await act(async () => heard().turn('Where is the'));
      // Still talking past the hold: the half question is not asked.
      await act(async () => heard().voice(true));
      await act(async () => jest.advanceTimersByTime(PAST_HOLD_MS));
      expect(has('instructor-question')).toBe(false);
      await act(async () => heard().voice(false));
      await act(async () => heard().turn('battery?'));
      expect(text('instructor-question')).toBe('Where is the battery?');
      expect(debug().getState().selectedPart).toBe('battery');
    });

    test('a spoken question joins the conversation under the step', async () => {
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
      const stepText = text('instructor-reply');
      await act(async () =>
        heard().partial('Where is the battery and how do I check its charge?'),
      );
      expect(text('instructor-reply')).toBe(stepText);
      expect(node('instructor-transcript').props.accessibilityLabel).toBe(
        'Provisional transcript: Where is the battery and how do I check its charge?',
      );
      await act(async () => heard().turn('Where is the battery?'));
      expect(has('instructor-transcript')).toBe(false);
      expect(text('thread-reply-0')).toBe(stepText);
      expect(text('instructor-question')).toBe('Where is the battery?');
      expect(text('instructor-reply')).toBe(
        pack.parts.find(part => part.id === 'battery')!.summary,
      );
    });

    test('the conversation keeps earlier answers as the steps move on', async () => {
      await mount({
        mode: LearnMode.instructor,
        procedureId: 'check-coolant',
        stepIndex: 0,
      });
      const steps = procedure('check-coolant').steps;
      await type('Where is the battery?');
      await press('instructor-next');
      expect(text('thread-reply-0')).toBe(steps[0].text);
      expect(text('thread-question-1')).toBe('Where is the battery?');
      expect(text('instructor-reply')).toBe(steps[1].text);
      expect(
        StyleSheet.flatten(node('instructor-panel').props.style).maxHeight,
      ).toBe('50%');
    });

    test('a typed question waits under the step until its answer has words', async () => {
      jest.mocked(useReducedMotion).mockReturnValue(true);
      jest.mocked(model.availability).mockReturnValue('available');
      const answer = deferred<string>();
      jest.mocked(model.respond).mockReturnValueOnce(answer.promise);
      await mount({ mode: LearnMode.instructor });
      const stepText = text('instructor-reply');
      await type('Explain the battery');
      expect(text('instructor-status')).toBe('Thinking');
      expect(text('instructor-question')).toBe('Explain the battery');
      expect(text('thread-reply-0')).toBe(stepText);
      expect(has('instructor-thinking')).toBe(true);
      const partial = jest.mocked(model.respond).mock.calls[0][2];
      await act(async () => partial(modelReply('It supplies')));
      expect(text('instructor-reply')).toBe('It supplies');
      expect(has('instructor-thinking')).toBe(false);
    });

    test.each(['denied', 'restricted'] as const)(
      '%s permission ends voice with a reason and leaves typing available',
      async permission => {
        jest.mocked(input.requestPermission).mockResolvedValueOnce(permission);
        await mount({ mode: LearnMode.instructor });
        await voiceOn();
        expect(input.listen).not.toHaveBeenCalled();
        expect(text('instructor-hint')).toBe(VoiceHint.permission);
        expect(has('instructor-input')).toBe(true);
        await type('next');
        expect(debug().getState().stepIndex).toBe(1);
      },
    );

    test('unavailable recognition ends voice with a reason', async () => {
      jest.mocked(input.prepare).mockResolvedValue('unavailable');
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
      expect(input.listen).not.toHaveBeenCalled();
      expect(text('instructor-hint')).toBe(VoiceHint.unavailable);
      expect(has('instructor-input')).toBe(true);
      // Typing a question moves on, so the notice about voice goes.
      await type('Where is the battery?');
      expect(has('instructor-hint')).toBe(false);
    });

    test('listening that fails or stops ends voice with a hint', async () => {
      jest.mocked(input.listen).mockRejectedValueOnce(new Error('audio busy'));
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
      expect(text('instructor-hint')).toBe(VoiceHint.lost);
      expect(has('instructor-input')).toBe(true);
      await voiceOn();
      expect(input.listen).toHaveBeenCalledTimes(2);
      await act(async () => heard().stopped('Speech recognition ended'));
      expect(text('instructor-hint')).toBe(VoiceHint.lost);
      expect(has('instructor-voice-bar')).toBe(false);
    });

    test('the voice button swaps the text field for the voice bar and back', async () => {
      await mount({ mode: LearnMode.instructor });
      expect(has('instructor-voice-bar')).toBe(false);
      await act(() => node('instructor-input').props.onChangeText('next'));
      expect(has('instructor-voice')).toBe(false);
      expect(has('instructor-send')).toBe(true);
      await act(() => node('instructor-input').props.onChangeText(''));
      await voiceOn();
      expect(has('instructor-input')).toBe(false);
      expect(has('instructor-voice-bar')).toBe(true);
      await press('instructor-voice-end');
      expect(input.cancel).toHaveBeenCalled();
      expect(has('instructor-input')).toBe(true);
      expect(has('instructor-voice-bar')).toBe(false);
    });

    test('chosen on the guide screen, voice is on from the first step', async () => {
      await mount({ mode: LearnMode.instructor, voice: true });
      expect(has('instructor-voice-bar')).toBe(true);
      expect(has('instructor-input')).toBe(false);
      await act(async () => {});
      expect(input.listen).toHaveBeenCalledTimes(1);
    });

    test('a spoken follow-up retains the previous question and reply', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      jest.mocked(model.respond).mockResolvedValue(modelReply());
      await mount({ mode: LearnMode.instructor });
      await ask('Explain the battery');
      await voiceOn();
      await act(async () => heard().turn('What does it do?'));
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
      await voiceOn();
      jest.mocked(output.speak).mockClear();
      await ask('Explain the battery safety');
      expect(text('instructor-reply')).toBe(reply);
      expect(has('instructor-caution-text')).toBe(false);
      expect(jest.mocked(output.speak).mock.calls).toEqual([
        [reply, VOICE_LOCALE, expect.any(Function)],
      ]);
    });

    test('streams the reply and highlights its part once the first words appear', async () => {
      jest.useFakeTimers();
      jest.mocked(model.availability).mockReturnValue('available');
      const answer = deferred<string>();
      jest.mocked(model.respond).mockReturnValueOnce(answer.promise);
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
      jest.mocked(output.speak).mockClear();
      await ask('Explain the battery');
      expect(text('instructor-status')).toBe('Thinking');
      expect(has('instructor-thinking')).toBe(true);
      expect(has('instructor-scan-sweep')).toBe(false);
      const partial = jest.mocked(model.respond).mock.calls[0][2];
      await act(async () => partial('  '));
      expect(debug().getState().selectedPart).toBeNull();
      expect(has('instructor-thinking')).toBe(true);
      await act(async () => partial('It **supplies**'));
      expect(debug().getState().selectedPart).toBe('battery');
      expect(text('instructor-reply')).toBe('');
      await act(async () => jest.advanceTimersByTime(500));
      expect(text('instructor-reply')).toBe('It supplies');
      expect(output.speak).not.toHaveBeenCalled();
      const longer =
        'It supplies the starter and supports the equipment electrical circuits.';
      await act(async () => partial(longer));
      await act(async () => jest.advanceTimersByTime(32));
      const growing = text('instructor-reply') as string;
      expect(growing.length).toBeGreaterThan('It supplies'.length);
      expect(growing.length).toBeLessThan(longer.length);
      await act(async () => {
        answer.resolve(longer);
      });
      expect(text('instructor-reply')).toBe(longer);
      expect(debug().getState().selectedPart).toBe('battery');
      expect(output.speak).toHaveBeenCalledWith(
        longer,
        VOICE_LOCALE,
        expect.any(Function),
      );
      jest.useRealTimers();
    });

    test('list answers render labelled cards and speak clean sentences with matching karaoke', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      const reply =
        '- **Check:** Inspect the battery terminals.\n- **Why:** Keep sparks away.';
      const spoken =
        'Check: Inspect the battery terminals. Why: Keep sparks away.';
      jest.mocked(model.respond).mockResolvedValueOnce(reply);
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
      jest.mocked(output.speak).mockClear();
      const speech = deferred<void>();
      jest.mocked(output.speak).mockReturnValueOnce(speech.promise);
      await ask('Explain the battery checks');
      expect(node('instructor-reply-item-1').props.accessibilityLabel).toBe(
        'Check: Inspect the battery terminals.',
      );
      expect(node('instructor-reply-item-2').props.accessibilityLabel).toBe(
        'Why: Keep sparks away.',
      );
      expect(output.speak).toHaveBeenCalledWith(
        spoken,
        VOICE_LOCALE,
        expect.any(Function),
      );
      await act(async () =>
        voiceEvents.emitWord(spoken.indexOf('sparks'), 'sparks'.length),
      );
      expect(text('instructor-reply-item-2-current')).toBe('sparks');
      expect(has('instructor-reply-item-1-current')).toBe(false);
      await act(async () => speech.resolve());
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
      await voiceOn();
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

    test('a pick interrupts streaming even when more words arrive about the same part', async () => {
      jest.mocked(model.availability).mockReturnValue('available');
      const answer = deferred<string>();
      const picked = deferred<number>();
      jest.mocked(model.respond).mockReturnValueOnce(answer.promise);
      view.pick.mockReturnValueOnce(picked.promise);
      await mount({ mode: LearnMode.instructor });
      await attach();
      await ask('Explain the battery');
      const partial = jest.mocked(model.respond).mock.calls[0][2];
      await act(async () => partial('It supplies'));
      await act(() =>
        emit(jest.mocked(useTapGesture).mock.calls.at(-1)![0]!.onActivate, {
          x: 150,
          y: 100,
        }),
      );
      await act(async () => partial('It supplies the starter'));
      await act(async () =>
        picked.resolve(
          pack.parts.find(part => part.id === 'coolant-reservoir')!.label,
        ),
      );
      expect(debug().getState().selectedPart).toBe('coolant-reservoir');
      await act(async () => answer.resolve('Late answer.'));
      expect(debug().getState().selectedPart).toBe('coolant-reservoir');
    });

    test.each(['failure', 'cancel', 'unselected final'])(
      'a replacing question restores a streamed selection before taking its baseline: %s',
      async outcome => {
        jest.mocked(model.availability).mockReturnValue('available');
        const first = deferred<string>();
        const second = deferred<string>();
        jest
          .mocked(model.respond)
          .mockReturnValueOnce(first.promise)
          .mockReturnValueOnce(second.promise);
        await mount({ mode: LearnMode.instructor });
        await ask('Explain the battery');
        const partial = jest.mocked(model.respond).mock.calls[0][2];
        await act(async () => partial('It supplies'));
        expect(debug().getState().selectedPart).toBe('battery');
        await ask('What gets hot when I drive?');
        expect(debug().getState().selectedPart).toBeNull();
        if (outcome === 'cancel') {
          await press('instructor-stop');
          await act(async () => second.resolve('Cancelled reply.'));
        } else if (outcome === 'unselected final') {
          await act(async () =>
            second.resolve('No data on that. Refer to the technical manual.'),
          );
        } else {
          await act(async () => second.reject(new Error('model failed')));
        }
        expect(debug().getState().selectedPart).toBeNull();
        await act(async () => {
          partial('Late words.');
          first.resolve('Late answer.');
        });
        expect(debug().getState().selectedPart).toBeNull();
      },
    );

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
      await voiceOn();
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
      expect(text('instructor-voice-status')).toBe('Speaking');
      await press('instructor-stop');
      expect(text('instructor-reply')).toBe(first.text);
      const calls = jest.mocked(output.speak).mock.calls.length;
      await act(async () => {
        speech.resolve();
      });
      expect(jest.mocked(output.speak).mock.calls.length).toBe(calls);
      expect(has('instructor-stop')).toBe(false);
    });

    test.each(['end voice', 'close', 'step', 'unmount'])(
      '%s stops speech and guards delayed completion',
      async change => {
        const speech = deferred<void>();
        await mount({ mode: LearnMode.instructor });
        await voiceOn();
        jest.mocked(output.speak).mockClear();
        jest.mocked(output.speak).mockReturnValueOnce(speech.promise);
        await ask('next');
        expect(text('instructor-voice-status')).toBe('Speaking');
        const stopped = jest.mocked(output.stop).mock.calls.length;
        if (change === 'end voice') {
          await press('instructor-voice-end');
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
        if (change === 'end voice') {
          expect(has('instructor-input')).toBe(true);
        }
      },
    );

    test('late recognition callbacks cannot ask once voice has ended', async () => {
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
      const { partial, turn } = heard();
      await press('instructor-voice-end');
      await type('next');
      await act(async () => {
        partial('old words');
        turn('Where is the battery?');
      });
      expect(text('instructor-question')).toBe('next');
      expect(debug().getState().selectedPart).toBeNull();
      expect(debug().getState().stepIndex).toBe(1);
    });

    test('speech output errors leave the written reply visible', async () => {
      await mount({ mode: LearnMode.instructor });
      await voiceOn();
      // The step read on turning voice on is fine; the answer to "next" fails.
      jest
        .mocked(output.speak)
        .mockRejectedValueOnce(new Error('voice unavailable'));
      await ask('next');
      expect(text('instructor-hint')).toBe(VoiceHint.output);
      expect(text('instructor-reply')).toBe(procedure('tour').steps[1].text);
    });

    test('opens in Instructor mode with the step to read and the toggle on', async () => {
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
      expect(text('step-counter')).toBe('Step 1 of 5');
    });

    test('a typed question shows the part and the answer', async () => {
      await mount({ mode: LearnMode.instructor });
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
      await act(() => node('instructor-input').props.onChangeText('Next step'));
      await act(async () => node('instructor-input').props.onSubmitEditing());
      expect(debug().getState().stepIndex).toBe(2);
      expect(text('instructor-reply')).toBe(
        procedure('check-coolant').steps[2].text,
      );
      await press('instructor-toggle');
      expect(text('step-counter')).toBe('Step 3 of 5');
    });

    test('debug ask drives the same path for end-to-end checks', async () => {
      await mount({ mode: LearnMode.instructor });
      await act(async () => debug().ask('check the brake fluid'));
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
