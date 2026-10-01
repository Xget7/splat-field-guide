import React from 'react';
import { ScrollView, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { catalogFor } from '../src/catalog/catalog';
import { CatalogProvider } from '../src/catalog/CatalogContext';
import { TOUR_ID } from '../src/domain/tour';
import { LearnMode, Route, type ScreenProps } from '../src/navigation/routes';
import { bundledPack } from '../src/packs/bundledPack';
import { procedureRowsFor } from '../src/screens/guideDetail';
import { GuideDetailScreen } from '../src/screens/GuideDetailScreen';
import { Space } from '../src/ui/theme';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
const catalog = catalogFor(pack);

test('bundled procedure rows preserve order, index, counts and safety notes', () => {
  expect(procedureRowsFor(pack)).toEqual([
    {
      id: TOUR_ID,
      index: '01',
      title: 'Parts tour',
      stepsLabel: '8 steps',
      hasCaution: false,
      accessibilityLabel: 'Parts tour, 8 steps',
    },
    {
      id: 'check-coolant',
      index: '02',
      title: 'Check the coolant level',
      stepsLabel: '5 steps',
      hasCaution: true,
      accessibilityLabel: 'Check the coolant level, 5 steps, has safety notes',
    },
    {
      id: 'check-brake-fluid',
      index: '03',
      title: 'Check the brake fluid level',
      stepsLabel: '5 steps',
      hasCaution: true,
      accessibilityLabel:
        'Check the brake fluid level, 5 steps, has safety notes',
    },
    {
      id: 'check-power-steering-fluid',
      index: '04',
      title: 'Check the power steering fluid level',
      stepsLabel: '5 steps',
      hasCaution: true,
      accessibilityLabel:
        'Check the power steering fluid level, 5 steps, has safety notes',
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
  ).toMatchObject({ index: '01', stepsLabel: '1 step', hasCaution: false });
});

describe('Guide detail screen', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const node = (testID: string) =>
    renderer.root
      .findAllByProps({ testID })
      .find(item => item.props.accessibilityRole === 'button') ??
    renderer.root.findByProps({ testID });
  const press = async (testID: string) => {
    await act(() => node(testID).props.onPress());
  };
  const mount = async (guideId = pack.packId) => {
    const props = {
      navigation,
      route: { key: 'detail', name: Route.guide, params: { guideId } },
    } as unknown as ScreenProps<typeof Route.guide>;
    await act(() => {
      renderer = ReactTestRenderer.create(
        <CatalogProvider catalog={catalog}>
          <GuideDetailScreen {...props} />
        </CatalogProvider>,
      );
    });
  };
  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => {
    await act(() => renderer.unmount());
  });

  test('a procedure and Start open step zero in Instructor by default', async () => {
    await mount();
    expect(node('mode-instructor').props.accessibilityState).toEqual({
      selected: true,
    });
    await press('procedure-row-check-coolant');
    expect(navigation.navigate).toHaveBeenLastCalledWith(Route.viewer, {
      guideId: pack.packId,
      procedureId: 'check-coolant',
      stepIndex: 0,
      mode: LearnMode.instructor,
    });
    await press('start-tour');
    expect(navigation.navigate).toHaveBeenLastCalledWith(Route.viewer, {
      guideId: pack.packId,
      procedureId: TOUR_ID,
      stepIndex: 0,
      mode: LearnMode.instructor,
    });
    await press('guide-back');
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
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
    expect(
      renderer.root
        .findAllByType(Text)
        .some(
          item => item.props.children === 'Read each step at your own pace.',
        ),
    ).toBe(true);
    await press('procedure-row-check-brake-fluid');
    expect(navigation.navigate).toHaveBeenLastCalledWith(Route.viewer, {
      guideId: pack.packId,
      procedureId: 'check-brake-fluid',
      stepIndex: 0,
      mode: LearnMode.selfGuided,
    });
    await press('start-tour');
    expect(navigation.navigate).toHaveBeenLastCalledWith(Route.viewer, {
      guideId: pack.packId,
      procedureId: TOUR_ID,
      stepIndex: 0,
      mode: LearnMode.selfGuided,
    });
  });

  test('scroll clearance follows the measured safety bar height', async () => {
    await mount();
    const height = 180;
    const bar = renderer.root.findAll(
      item => typeof item.props.onLayout === 'function',
    )[0];
    await act(() =>
      bar.props.onLayout({ nativeEvent: { layout: { height } } }),
    );
    expect(
      renderer.root.findByType(ScrollView).props.contentContainerStyle
        .paddingBottom,
    ).toBe(height + Space.xl);
  });

  test.each(['missing', catalog[1].id])(
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
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
      expect(navigation.navigate).not.toHaveBeenCalled();
    },
  );
});
