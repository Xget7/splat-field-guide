import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  catalogFor,
  type ReadyGuide,
} from '../apps/field-guide/src/features/pack/catalog';
import { CatalogProvider } from '../apps/field-guide/src/app/CatalogContext';
import { TOUR_ID } from '../apps/field-guide/src/features/guide/tour';
import {
  LearnMode,
  Route,
  type ScreenProps,
} from '../apps/field-guide/src/app/routes';
import { bundledPack } from '../apps/field-guide/src/features/pack/bundledPack';
import { procedureRowsFor } from '../apps/field-guide/src/features/guide/procedureRows';
import { GuideDetailScreen } from '../apps/field-guide/src/screens/guide-detail/GuideDetailScreen';

jest.mock('react-native-splat', () => ({ ModelView: 'ModelView' }));
jest.mock('react-native-nitro-modules', () => ({
  callback: (fn: unknown) => fn,
}));

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
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
      stepsLabel: '5 steps',
      hasCaution: true,
      accessibilityLabel: 'Check the coolant level, 5 steps, has safety notes',
    },
    {
      id: 'check-brake-fluid',
      title: 'Check the brake fluid level',
      stepsLabel: '5 steps',
      hasCaution: true,
      accessibilityLabel:
        'Check the brake fluid level, 5 steps, has safety notes',
    },
    {
      id: 'check-power-steering-fluid',
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
  ).toMatchObject({ stepsLabel: '1 step', hasCaution: false });
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
    expect(
      renderer.root.findAllByProps({ testID: `procedure-row-${TOUR_ID}` }),
    ).toHaveLength(0);
    expect(node('mode-instructor').props.accessibilityState).toEqual({
      selected: true,
    });
    await press('procedure-row-check-coolant');
    expect(navigation.navigate).toHaveBeenLastCalledWith(Route.viewer, {
      guideId: pack.packId,
      procedureId: 'check-coolant',
      stepIndex: 0,
      mode: LearnMode.instructor,
      voice: false,
    });
    await press('start-tour');
    expect(navigation.navigate).toHaveBeenLastCalledWith(Route.viewer, {
      guideId: pack.packId,
      procedureId: TOUR_ID,
      stepIndex: 0,
      mode: LearnMode.instructor,
      voice: false,
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
    await press('procedure-row-check-brake-fluid');
    expect(navigation.navigate).toHaveBeenLastCalledWith(Route.viewer, {
      guideId: pack.packId,
      procedureId: 'check-brake-fluid',
      stepIndex: 0,
      mode: LearnMode.selfGuided,
      voice: false,
    });
    await press('start-tour');
    expect(navigation.navigate).toHaveBeenLastCalledWith(Route.viewer, {
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
    expect(navigation.navigate).toHaveBeenLastCalledWith(
      Route.viewer,
      expect.objectContaining({ mode: LearnMode.instructor, voice: true }),
    );
    await press('mode-self-guided');
    expect(
      renderer.root.findAllByProps({ testID: 'voice-assistant' }),
    ).toHaveLength(0);
    await press('start-tour');
    expect(navigation.navigate).toHaveBeenLastCalledWith(
      Route.viewer,
      expect.objectContaining({ mode: LearnMode.selfGuided, voice: false }),
    );
  });

  test('a shared build keeps the physical alignment check hidden', async () => {
    await mount();
    expect(renderer.root.findAllByProps({ testID: 'open-ar' })).toHaveLength(0);
    await press('start-tour');
    expect(navigation.navigate).toHaveBeenCalledWith(
      Route.viewer,
      expect.anything(),
    );
  });

  test('the hero turns the model from the library card', async () => {
    await mount();
    const model = renderer.root.findByType('ModelView' as never);
    expect(model.props.modelPath).toBe((catalog[0] as ReadyGuide).model);
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
