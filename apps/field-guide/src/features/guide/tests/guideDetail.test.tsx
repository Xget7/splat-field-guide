import React from 'react';
import { Dimensions, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { catalogFor } from '../../pack/catalog';
import type { Pack } from '../../pack/pack';
import { parsePack } from '../../pack/parsePack';
import { TOUR_ID } from '../../pack/tour';
import type {
  CourseDocument,
  CourseDocuments,
} from '../../../platform/documents';
import { LearnMode } from '../domain/learningMode';
import { fixtureCopy, fixturePack } from '@tests/fixturePack';
import { procedureRowsFor } from '../domain/procedureRows';
import { GuideDetailScreen } from '../ui/GuideDetailScreen';

jest.mock('react-native-nitro-modules', () => ({
  callback: (fn: unknown) => fn,
}));

const pack = fixturePack();
const catalog = catalogFor([pack]);
const LANDSCAPE_IPAD = { width: 1376, height: 1032, scale: 2, fontScale: 1 };

const SUMMARY = 'A compact engine bay: the engine and its fluid reservoirs.';
const COOLANT_OBJECTIVE = 'Read the coolant level without opening a hot cap.';
/** The fixture with the optional course outline a refreshed pack carries. */
function outlinedPack(): Pack {
  const manifest = fixtureCopy();
  manifest.summary = SUMMARY;
  Object.assign(manifest.procedures[0], {
    objective: COOLANT_OBJECTIVE,
    audience: 'maintenance',
    machine: 'engine',
  });
  manifest.procedures[1].audience = 'operator';
  manifest.references = [
    {
      document: 'manual-v6',
      title: 'Robot anatomy',
      section: '2.2',
      // Packs author the figure with its printed prefix.
      figure: 'Fig. 2-2',
      page: 16,
      parts: ['engine'],
    },
    { document: 'manual-v4', title: 'Safety zones', section: '3.2', page: 20 },
  ];
  const result = parsePack(manifest);
  if (!result.ok) throw new Error(result.error.message);
  return result.pack;
}

const document = (
  id: string,
  edition: string,
  available: boolean,
): CourseDocument => ({
  id,
  title: edition,
  edition,
  issued: '2024-01-26',
  pages: 400,
  pageOffset: 0,
  available,
});

function fakeDocuments(): jest.Mocked<CourseDocuments> {
  return {
    list: jest.fn(async () => [
      document('manual-v6', 'MA V6', true),
      document('manual-v4', 'BA V4', false),
    ]),
    open: jest.fn(async (_id: string, _page?: number) => undefined),
  };
}

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
  const texts = () =>
    renderer.root.findAllByType(Text).map(item => item.props.children);
  /** Every string on screen, nested text included. */
  const words = () =>
    texts()
      .flat()
      .filter(part => typeof part === 'string');
  const mount = async (
    guideId = pack.packId,
    {
      guides = catalog,
      documents,
    }: { guides?: typeof catalog; documents?: CourseDocuments } = {},
  ) => {
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <GuideDetailScreen
          catalog={guides}
          guideId={guideId}
          documents={documents}
          onBack={onBack}
          onOpen={onOpen}
        />,
      );
    });
  };
  const mountOutlined = async (documents?: CourseDocuments) => {
    const outlined = outlinedPack();
    await mount(outlined.packId, {
      guides: catalogFor([outlined]),
      documents,
    });
    return outlined;
  };
  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => {
    await act(() => renderer.unmount());
  });

  test('a procedure and Start open step zero with the instructor speaking, with no mode or voice choice here', async () => {
    await mount();
    for (const choice of [
      'mode-instructor',
      'mode-self-guided',
      'voice-assistant',
    ]) {
      expect(renderer.root.findAllByProps({ testID: choice })).toHaveLength(0);
    }
    await press('procedure-row-check-coolant');
    expect(onOpen).toHaveBeenLastCalledWith({
      guideId: pack.packId,
      procedureId: 'check-coolant',
      stepIndex: 0,
      mode: LearnMode.instructor,
      voice: true,
    });
    await press('start-tour');
    expect(onOpen).toHaveBeenLastCalledWith({
      guideId: pack.packId,
      procedureId: TOUR_ID,
      stepIndex: 0,
      mode: LearnMode.instructor,
      voice: true,
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

  test('an older pack without an outline reads cleanly: no summary and no documentation', async () => {
    await mount(pack.packId, { documents: fakeDocuments() });
    expect(texts()).toEqual(
      expect.arrayContaining([
        'Fixture engine bay',
        'Start here',
        'Robots',
        '3 steps',
        'Engine summary',
      ]),
    );
    expect(texts()).not.toContain('KUKA documentation');
    expect(texts()).not.toContain(undefined);
    expect(texts().filter(text => text === '')).toHaveLength(0);
  });

  test('the tour is offered once, by the start button alone, and whole-cell modules start here', async () => {
    await mountOutlined();
    expect(texts()).toContain(SUMMARY);
    const ids = renderer.root
      .findAll(
        item =>
          typeof item.props.testID === 'string' &&
          item.props.testID.startsWith('procedure-row-') &&
          typeof item.props.onPress === 'function',
      )
      .map(item => item.props.testID)
      // Composite and host elements repeat the same test ID.
      .filter((id, index, all) => all.indexOf(id) === index);
    // The coolant check belongs to the engine, so it is listed with that robot and nowhere else.
    expect(ids).toEqual([
      'procedure-row-check-brake-fluid',
      'procedure-row-check-power-steering-fluid',
      'procedure-row-check-coolant',
    ]);
    expect(node('procedure-row-check-coolant').props.accessibilityLabel).toBe(
      `Check the coolant level. ${COOLANT_OBJECTIVE} Maintenance, 3 steps`,
    );
    expect(texts()).not.toContain('Parts tour');
    // The button is the whole offer: no line restates the tour's coverage or length.
    expect(words().some(text => text.startsWith('Identify'))).toBe(false);
    expect(words()).not.toContain('8 steps');
    expect(texts()).toContain('Operator, 2 steps');
    await press('procedure-row-check-coolant');
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ procedureId: 'check-coolant', stepIndex: 0 }),
    );
  });

  test('tapping a robot frames and highlights it in the preview, and tapping again returns to the cell', async () => {
    const outlined = await mountOutlined();
    const native = { frame: jest.fn(), orbit: jest.fn() };
    const scene = () =>
      renderer.root.findByType('SplatView' as React.ElementType);
    const preview = renderer.root
      .findAllByProps({ testID: 'guide-preview' })
      .find(item => typeof item.props.onLayout === 'function')!;
    await act(() => {
      preview.props.onLayout({
        nativeEvent: { layout: { width: 800, height: 600 } },
      });
      scene().props.hybridRef(native);
      scene().props.onReady();
    });
    const [, , overview] = native.frame.mock.calls[0];
    await press('machine-row-engine');
    expect(node('machine-row-engine').props.accessibilityState).toEqual({
      disabled: false,
      selected: true,
    });
    const engine = outlined.parts.filter(
      part => part.id === 'engine' || part.parent === 'engine',
    );
    expect(scene().props.highlight).toEqual(engine.map(part => part.label));
    expect(native.frame).toHaveBeenCalledTimes(2);
    const [bounds, seconds] = native.frame.mock.calls[1];
    expect(seconds).toBeGreaterThan(0);
    // The engine spans x 10 to 14, so its framing stays around it rather than the whole bay.
    expect(bounds.min.x).toBeGreaterThan(5);
    await press('machine-row-engine');
    expect(scene().props.highlight).toEqual([]);
    expect(native.frame.mock.calls[2][2]).toEqual(overview);
  });

  test('a cited manual page opens at that page and unavailable documents are disabled', async () => {
    const documents = fakeDocuments();
    await mountOutlined(documents);
    expect(texts()).toContain('KUKA documentation');
    expect(texts()).toContain('MA V6, Sec. 2.2, Fig. 2-2, p. 16');
    expect(texts()).toContain('BA V4, Sec. 3.2, p. 20. Not on this device');
    expect(node('reference-row-1').props.accessibilityState).toEqual({
      disabled: true,
    });
    await press('reference-row-0');
    expect(documents.open).toHaveBeenCalledWith('manual-v6', 16);
    documents.open.mockRejectedValueOnce(new Error('unreadable'));
    await press('reference-row-0');
    expect(texts()).toContain('Could not open this document. Try again.');
  });

  test('the landscape layout shows the same sections once beside the preview', async () => {
    const phone = Dimensions.get('window');
    Dimensions.set({ window: LANDSCAPE_IPAD, screen: LANDSCAPE_IPAD });
    try {
      await mountOutlined(fakeDocuments());
      for (const heading of ['Start here', 'Robots', 'KUKA documentation']) {
        expect(texts().filter(text => text === heading)).toHaveLength(1);
      }
      expect(
        renderer.root.findAllByType('SplatView' as React.ElementType),
      ).toHaveLength(1);
      await press('start-tour');
      expect(onOpen).toHaveBeenLastCalledWith(
        expect.objectContaining({ procedureId: TOUR_ID }),
      );
    } finally {
      await act(async () => Dimensions.set({ window: phone, screen: phone }));
    }
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
