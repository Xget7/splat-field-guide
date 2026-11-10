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
const catalog = catalogFor(pack);

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
