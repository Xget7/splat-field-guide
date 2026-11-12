import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { catalogFor } from '../../pack/catalog';
import { TOUR_ID } from '../../pack/tour';
import { LearnMode } from '../domain/learningMode';
import { fixturePack } from '@tests/fixturePack';
import { procedureRowsFor } from '../domain/procedureRows';
import { GuideDetailScreen } from '../ui/GuideDetailScreen';

jest.mock('react-native-nitro-modules', () => ({
  callback: (fn: unknown) => fn,
}));

const pack = fixturePack();
const catalog = catalogFor([pack]);

test('bundled procedure rows preserve order, counts and safety notes', () => {
  expect(procedureRowsFor(pack)).toEqual([
    {
      id: TOUR_ID,
      title: 'Parts tour',
      stepsLabel: '8 steps',
      hasCaution: false,
      accessibilityLabel: 'Parts tour, 8 steps',
    },
    {
      id: 'check-coolant',
      title: 'Check the coolant level',
      stepsLabel: '3 steps',
      hasCaution: true,
      accessibilityLabel: 'Check the coolant level, 3 steps, has safety notes',
    },
    {
      id: 'check-brake-fluid',
      title: 'Check the brake fluid level',
      stepsLabel: '2 steps',
      hasCaution: false,
      accessibilityLabel: 'Check the brake fluid level, 2 steps',
    },
    {
      id: 'check-power-steering-fluid',
      title: 'Check the power steering fluid level',
      stepsLabel: '2 steps',
      hasCaution: false,
      accessibilityLabel: 'Check the power steering fluid level, 2 steps',
    },
  ]);
});

test('one step is singular and an empty caution is not a safety note', () => {
  const procedure = pack.procedures[1];
  expect(
    procedureRowsFor({
      ...pack,
      procedures: [
        { ...procedure, steps: [{ ...procedure.steps[0], caution: '' }] },
      ],
    })[0],
  ).toMatchObject({ stepsLabel: '1 step', hasCaution: false });
});

describe('Guide detail screen', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const onOpen = jest.fn();
  const onBack = jest.fn();
  const node = (testID: string) =>
    renderer.root
      .findAllByProps({ testID })
      .find(item => item.props.accessibilityRole === 'button') ??
    renderer.root.findByProps({ testID });
  const press = async (testID: string) => {
    await act(() => node(testID).props.onPress());
  };
  const mount = async (guideId = pack.packId) => {
    await act(() => {
      renderer = ReactTestRenderer.create(
        <GuideDetailScreen
          catalog={catalog}
          guideId={guideId}
          onBack={onBack}
          onOpen={onOpen}
        />,
      );
    });
  };
  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => {
    await act(() => renderer.unmount());
  });

  test('a procedure and Start open step zero in Instructor by default', async () => {
    await mount();
    expect(
      renderer.root.findAllByProps({ testID: `procedure-row-${TOUR_ID}` }),
    ).toHaveLength(0);
    expect(node('mode-instructor').props.accessibilityState).toEqual({
      selected: true,
    });
    await press('procedure-row-check-coolant');
    expect(onOpen).toHaveBeenLastCalledWith({
      guideId: pack.packId,
      procedureId: 'check-coolant',
      stepIndex: 0,
      mode: LearnMode.instructor,
      voice: false,
    });
    await press('start-tour');
    expect(onOpen).toHaveBeenLastCalledWith({
      guideId: pack.packId,
      procedureId: TOUR_ID,
      stepIndex: 0,
      mode: LearnMode.instructor,
      voice: false,
    });
    await press('guide-back');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('the entry presents the bundled 3D scene before an activity starts', async () => {
    await mount();
    const scene = renderer.root.findByType('SplatView' as React.ElementType);
    expect(scene.props.source.splatPath).toBe(
      'packs/fixture/1/high/world.lodsplat',
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('leaving the entry releases its native scene and returning mounts it again', async () => {
    await mount();
    await press('start-tour');
    expect(
      renderer.root.findAllByType('SplatView' as React.ElementType),
    ).toHaveLength(0);
    await act(() => {
      renderer.update(
        <GuideDetailScreen
          catalog={catalog}
          guideId={pack.packId}
          onBack={onBack}
          onOpen={onOpen}
          active={false}
        />,
      );
    });
    await act(() => {
      renderer.update(
        <GuideDetailScreen
          catalog={catalog}
          guideId={pack.packId}
          onBack={onBack}
          onOpen={onOpen}
          active
        />,
      );
    });
    expect(
      renderer.root.findAllByType('SplatView' as React.ElementType),
    ).toHaveLength(1);
  });

  test('the ready native preview supports rotation and recentering', async () => {
    await mount();
    const native = { frame: jest.fn(), orbit: jest.fn() };
    const scene = renderer.root.findByType('SplatView' as React.ElementType);
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: 'Rotate preview right',
      }),
    ).toHaveLength(0);
    const preview = renderer.root
      .findAllByProps({ testID: 'guide-preview' })
      .find(item => typeof item.props.onLayout === 'function')!;
    await act(() => {
      preview.props.onLayout({
        nativeEvent: { layout: { width: 800, height: 600 } },
      });
      scene.props.hybridRef(native);
      scene.props.onReady();
    });
    expect(native.frame).toHaveBeenCalledTimes(1);
    const control = (label: string) =>
      renderer.root
        .findAllByProps({ accessibilityLabel: label })
        .find(item => item.props.accessibilityRole === 'button')!;
    await act(() => control('Rotate preview right').props.onPress());
    expect(native.orbit).toHaveBeenCalledWith(Math.PI / 8, 0);
    await act(() => control('Rotate preview left').props.onPress());
    expect(native.orbit).toHaveBeenLastCalledWith(-Math.PI / 8, 0);
    await act(() => control('Recenter preview').props.onPress());
    expect(native.frame).toHaveBeenCalledTimes(2);
  });

  test('native preview failures are visible and retry starts a fresh native lifetime', async () => {
    await mount();
    const first = renderer.root.findByType('SplatView' as React.ElementType);
    await act(() =>
      first.props.onError({
        code: 'load-failed',
        message: 'Preview files could not be opened.',
      }),
    );
    expect(
      renderer.root.findAllByType(Text).map(item => item.props.children),
    ).toContain('Preview files could not be opened.');
    await act(() =>
      renderer.root.findByProps({ label: 'Retry preview' }).props.onPress(),
    );
    const replacement = renderer.root.findByType(
      'SplatView' as React.ElementType,
    );
    expect(replacement).not.toBe(first);
    expect(
      renderer.root.findAllByType(Text).map(item => item.props.children),
    ).toContain('Loading 3D preview');
    expect(
      renderer.root.findAllByType(Text).map(item => item.props.children),
    ).not.toContain('Preview files could not be opened.');
  });

  test('selected mode drives both procedure and Start navigation', async () => {
    await mount();
    await press('mode-self-guided');
    expect(node('mode-self-guided').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(node('mode-instructor').props.accessibilityState).toEqual({
      selected: false,
    });
    await press('procedure-row-check-brake-fluid');
    expect(onOpen).toHaveBeenLastCalledWith({
      guideId: pack.packId,
      procedureId: 'check-brake-fluid',
      stepIndex: 0,
      mode: LearnMode.selfGuided,
      voice: false,
    });
    await press('start-tour');
    expect(onOpen).toHaveBeenLastCalledWith({
      guideId: pack.packId,
      procedureId: TOUR_ID,
      stepIndex: 0,
      mode: LearnMode.selfGuided,
      voice: false,
    });
  });

  test('both learning modes explain their behavior without empty subtitle punctuation', async () => {
    await mount();
    const text = renderer.root
      .findAllByType(Text)
      .map(item => item.props.children);
    expect(text).toContain(
      'Steps on screen, and answers about any part you ask.',
    );
    expect(text).toContain('Just the steps, read at your own pace.');
    expect(text).not.toContain(', ');
  });

  test('the voice assistant is an Instructor choice that opens the viewer in voice', async () => {
    await mount();
    await press('voice-assistant');
    expect(node('voice-assistant').props.accessibilityState).toEqual({
      checked: true,
    });
    await press('start-tour');
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: LearnMode.instructor, voice: true }),
    );
    await press('mode-self-guided');
    expect(
      renderer.root.findAllByProps({ testID: 'voice-assistant' }),
    ).toHaveLength(0);
    await press('start-tour');
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: LearnMode.selfGuided, voice: false }),
    );
  });

  test.each(['missing', 'tactical-truck-engine-bay'])(
    'unavailable guide has a message and back action: %s',
    async id => {
      await mount(id);
      expect(
        renderer.root
          .findAllByType(Text)
          .some(item => item.props.children === 'Guide unavailable.'),
      ).toBe(true);
      expect(
        renderer.root.findAllByProps({ testID: 'start-tour' }),
      ).toHaveLength(0);
      await press('guide-back');
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(onOpen).not.toHaveBeenCalled();
    },
  );
});
