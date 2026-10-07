import React from 'react';
import { NavigationContext } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { catalogFor } from '../apps/field-guide/src/features/pack/catalog';
import { CatalogProvider } from '../apps/field-guide/src/app/CatalogContext';
import {
  LearnMode,
  Route,
  type ScreenProps,
} from '../apps/field-guide/src/app/routes';
import { bundledPack } from '../apps/field-guide/src/features/pack/bundledPack';
import { saveProgress } from '../apps/field-guide/src/app/progressStorage';
import { continueRowFor } from '../apps/field-guide/src/screens/library/library';
import { LibraryScreen } from '../apps/field-guide/src/screens/library/LibraryScreen';

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const pack = bundledPack.pack;
const catalog = catalogFor(pack);
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

describe('Library screen', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const listeners = new Map<string, () => void>();
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    isFocused: () => true,
    addListener: jest.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return () => {
        listeners.delete(event);
      };
    }),
  };
  const props = {
    navigation,
    route: { key: 'library', name: Route.library, params: undefined },
  } as unknown as ScreenProps<typeof Route.library>;
  const node = (testID: string) =>
    renderer.root
      .findAllByProps({ testID })
      .find(item => item.props.accessibilityRole === 'button') ??
    renderer.root.findByProps({ testID });
  const press = async (testID: string) => {
    await act(() => node(testID).props.onPress());
  };
  const mount = async () => {
    await act(() => {
      renderer = ReactTestRenderer.create(
        <CatalogProvider catalog={catalog}>
          <NavigationContext.Provider value={props.navigation}>
            <LibraryScreen {...props} />
          </NavigationContext.Provider>
        </CatalogProvider>,
      );
    });
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });
  afterEach(async () => {
    if (renderer) {
      await act(() => renderer.unmount());
    }
  });

  test('ready card opens its guide and coming soon cards are informational', async () => {
    await mount();
    await press(`guide-card-${pack.packId}`);
    expect(navigation.navigate).toHaveBeenCalledWith(Route.guide, {
      guideId: pack.packId,
    });
    expect(node(`soon-card-${catalog[1].id}`).props.accessibilityLabel).toBe(
      'Tactical truck, Engine bay, coming soon',
    );
    expect(node(`soon-card-${catalog[1].id}`).props.onPress).toBeUndefined();
    expect(
      renderer.root.findAllByProps({ testID: 'library-continue' }),
    ).toHaveLength(0);
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
    expect(navigation.navigate).toHaveBeenCalledTimes(2);
    expect(navigation.navigate).toHaveBeenLastCalledWith(Route.viewer, {
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
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
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
    expect(navigation.navigate).toHaveBeenLastCalledWith(Route.viewer, {
      ...newer,
      mode: LearnMode.selfGuided,
    });
  });

  test('storage failure leaves the library usable', async () => {
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('unavailable'));
    await mount();
    expect(
      renderer.root.findAllByProps({ testID: 'library-continue' }),
    ).toHaveLength(0);
    await press(`guide-card-${pack.packId}`);
    expect(navigation.navigate).toHaveBeenCalledWith(Route.guide, {
      guideId: pack.packId,
    });
  });
});
