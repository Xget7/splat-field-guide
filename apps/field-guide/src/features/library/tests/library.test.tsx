import React from 'react';
import { NavigationContext } from '@react-navigation/native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { catalogFor, type ReadyGuide } from '../../pack/catalog';
import { fakeStorage } from '@tests/platform';
import {
  createProgressStorage,
  LearnMode,
  type ProgressStorage,
} from '../../guide';
import { bundledPack } from '../../pack/bundledPack';

import { continueRowFor, factsFor } from '../domain/library';
import { LibraryScreen } from '../ui/LibraryScreen';

jest.mock('react-native-nitro-modules', () => ({
  callback: (fn: unknown) => fn,
}));

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
const catalog = catalogFor(pack);
const guide = catalog[0] as ReadyGuide;
const progress = {
  guideId: pack.packId,
  procedureId: 'check-coolant',
  stepIndex: 1,
} as const;

test.each([
  null,
  { ...progress, guideId: 'unknown' },
  { ...progress, guideId: catalog[1].id },
  { ...progress, procedureId: 'unknown' },
  { ...progress, stepIndex: -1 },
  { ...progress, stepIndex: 1.5 },
  { ...progress, stepIndex: 5 },
])('invalid or stale progress has no continue row: %j', saved => {
  expect(continueRowFor(catalog, saved)).toBeNull();
});

test('continue shows one-based progress and a fraction of the procedure', () => {
  expect(continueRowFor(catalog, progress)).toMatchObject({
    guide: catalog[0],
    procedure: pack.procedures[1],
    stepIndex: 1,
    stepLabel: 'Step 2 of 5',
    fraction: 2 / 5,
  });
});

test('a guide counts its parts and authored procedures, leaving out the tour', () => {
  const authored = pack.procedures.length - 1;
  expect(pack.procedures[0].id).toBe('tour');
  expect(factsFor(guide)).toEqual([
    `${pack.parts.length} parts`,
    `${authored} procedures`,
  ]);
});

describe('Library screen', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const listeners = new Map<string, () => void>();
  // Only the focus events reach the screen; it opens everything through its callbacks.
  const navigation = {
    isFocused: () => true,
    addListener: jest.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return () => {
        listeners.delete(event);
      };
    }),
  };
  const onOpenGuide = jest.fn();
  const onOpen = jest.fn();
  const onOpenAssembly = jest.fn();
  let device: ReturnType<typeof fakeStorage>;
  let storage: ProgressStorage;
  const saveProgress = (saved: Parameters<ProgressStorage['save']>[0]) =>
    storage.save(saved);
  const node = (testID: string) =>
    renderer.root
      .findAllByProps({ testID })
      .find(item => item.props.accessibilityRole === 'button') ??
    renderer.root.findByProps({ testID });
  const press = async (testID: string) => {
    await act(() => node(testID).props.onPress());
  };
  const mount = async (offersAssembly = true) => {
    await act(() => {
      renderer = ReactTestRenderer.create(
        <NavigationContext.Provider
          value={
            navigation as unknown as React.ContextType<typeof NavigationContext>
          }
        >
          <LibraryScreen
            catalog={catalog}
            progress={storage}
            onOpenGuide={onOpenGuide}
            onOpen={onOpen}
            onOpenAssembly={offersAssembly ? onOpenAssembly : undefined}
          />
        </NavigationContext.Provider>,
      );
    });
  };
  beforeEach(() => {
    jest.clearAllMocks();
    device = fakeStorage();
    storage = createProgressStorage(device.storage);
  });
  afterEach(async () => {
    if (renderer) {
      await act(() => renderer.unmount());
    }
  });

  test('ready card opens its guide and coming soon cards are informational', async () => {
    await mount();
    await press(`guide-card-${pack.packId}`);
    expect(onOpenGuide).toHaveBeenCalledWith(guide);
    expect(node(`soon-card-${catalog[1].id}`).props.accessibilityLabel).toBe(
      'Tactical truck, Engine bay, coming soon',
    );
    expect(node(`soon-card-${catalog[1].id}`).props.onPress).toBeUndefined();
    await press('open-ar-assembly');
    expect(onOpenAssembly).toHaveBeenCalledTimes(1);
    expect(
      renderer.root.findAllByProps({ testID: 'library-continue' }),
    ).toHaveLength(0);
  });

  test('the spatial assembly entry shows only where the device offers it', async () => {
    await mount(false);
    expect(
      renderer.root.findAllByProps({ testID: 'open-ar-assembly' }),
    ).toHaveLength(0);
  });

  test('the ready card turns its model and shows the photo when the model cannot load', async () => {
    await mount();
    const card = renderer.root.findByProps({
      testID: `guide-card-${pack.packId}`,
    });
    const model = card.findByType('ModelView' as never);
    expect(model.props.modelPath).toBe(guide.model);
    expect(card.findAllByProps({ source: guide.image })).toHaveLength(0);
    await act(() => model.props.onLoaded(false));
    expect(card.findAllByType('ModelView' as never)).toHaveLength(0);
    expect(card.findAllByProps({ source: guide.image }).length).toBeGreaterThan(
      0,
    );
  });

  test('saved progress opens the same step from the row and its play button', async () => {
    await saveProgress(progress);
    await mount();
    await press('library-continue');
    await act(() =>
      node('library-continue')
        .findAll(
          item =>
            item.props.accessibilityRole === 'button' &&
            typeof item.props.onPress === 'function',
        )
        .at(-1)!
        .props.onPress(),
    );
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith({
      ...progress,
      mode: LearnMode.selfGuided,
    });
  });

  test('focus re-reads progress and removes a stale record', async () => {
    await mount();
    await act(() => listeners.get('blur')?.());
    await saveProgress(progress);
    await act(() => listeners.get('focus')?.());
    expect(node('library-continue')).toBeDefined();
    await act(() => listeners.get('blur')?.());
    await saveProgress({ ...progress, procedureId: 'removed' });
    await act(() => listeners.get('focus')?.());
    expect(
      renderer.root.findAllByProps({ testID: 'library-continue' }),
    ).toHaveLength(0);
  });

  test('a storage read from the previous focus cannot replace newer progress', async () => {
    let resolve!: (saved: string | null) => void;
    device.storage.getItem.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    await mount();
    await act(() => listeners.get('blur')?.());
    const newer = { ...progress, stepIndex: 2 };
    await saveProgress(newer);
    await act(() => listeners.get('focus')?.());
    await act(() => resolve(JSON.stringify(progress)));
    await press('library-continue');
    expect(onOpen).toHaveBeenLastCalledWith({
      ...newer,
      mode: LearnMode.selfGuided,
    });
  });

  test('storage failure leaves the library usable', async () => {
    device.storage.getItem.mockRejectedValueOnce(new Error('unavailable'));
    await mount();
    expect(
      renderer.root.findAllByProps({ testID: 'library-continue' }),
    ).toHaveLength(0);
    await press(`guide-card-${pack.packId}`);
    expect(onOpenGuide).toHaveBeenCalledWith(guide);
  });
});
