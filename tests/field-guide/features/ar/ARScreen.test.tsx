import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import { catalogFor } from '../../../../apps/field-guide/src/modules/catalog/catalog';
import { CatalogProvider } from '../../../../apps/field-guide/src/modules/catalog/CatalogContext';
import {
  Route,
  type ScreenProps,
} from '../../../../apps/field-guide/src/shared/navigation/routes';
import { bundledPack } from '../../../../apps/field-guide/src/modules/packs/bundledPack';
import { ARScreen } from '../../../../apps/field-guide/src/features/ar/screens/ARScreen';

jest.mock('react-native-splat', () => ({ ARGuideView: 'ARGuideView' }));
jest.mock('react-native-nitro-modules', () => ({
  callback: (fn: unknown) => fn,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 34, left: 0, right: 0 }),
}));

if (!bundledPack.ok) {
  throw new Error(bundledPack.error.message);
}
const catalog = catalogFor(bundledPack.pack);

describe('AR alignment screen', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const goBack = jest.fn();
  const node = (testID: string) => renderer.root.findByProps({ testID });
  const native = () =>
    renderer.root.findByType('ARGuideView' as React.ElementType);
  const event = async (state: string, message: string) => {
    await act(() =>
      native().props.onTrackingStateChanged(JSON.stringify({ state, message })),
    );
  };

  beforeEach(async () => {
    goBack.mockClear();
    const props = {
      navigation: { goBack },
      route: {
        key: 'ar-test',
        name: Route.ar,
        params: { guideId: 'gol-trend-engine-bay' },
      },
    } as unknown as ScreenProps<typeof Route.ar>;
    await act(() => {
      renderer = ReactTestRenderer.create(
        <CatalogProvider catalog={catalog}>
          <ARScreen {...props} />
        </CatalogProvider>,
      );
    });
  });

  afterEach(async () => {
    await act(() => renderer.unmount());
    jest.restoreAllMocks();
  });

  test('uses local assets and reflects recognition loss without claiming a match', async () => {
    expect(native().props.referencePath).toBe(
      'ar/gol-trend-engine-bay/engine-bay.referenceobject',
    );
    await event('searching', 'Point at the engine.');
    expect(node('ar-status').props.children).toBe('Looking for your engine');
    await event('tracking', 'Check the four points.');
    expect(node('ar-status').props.children).toBe('Engine located');
    await event('limited', 'Bring the engine back into view.');
    expect(node('ar-status').props.children).toBe(
      'Move slowly to find the engine',
    );
    expect(node('ar-message').props.children).toBe(
      'Bring the engine back into view.',
    );
  });

  test('ignores malformed events and unknown states', async () => {
    await event('searching', 'Point at the engine.');
    await act(() => native().props.onTrackingStateChanged('{invalid'));
    await event('constructor', 'A false status');
    expect(node('ar-status').props.children).toBe('Looking for your engine');
    expect(node('ar-message').props.children).toBe('Point at the engine.');
  });

  test('offers camera settings after denial and a way back', async () => {
    const openSettings = jest
      .spyOn(Linking, 'openSettings')
      .mockResolvedValue();
    await event('permission-denied', 'Enable the camera in Settings.');
    await act(() => node('ar-settings').props.onPress());
    expect(openSettings).toHaveBeenCalledTimes(1);
    await act(() => node('ar-back').props.onPress());
    expect(goBack).toHaveBeenCalledTimes(1);
  });
});
