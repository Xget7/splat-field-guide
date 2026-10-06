import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import { catalogFor } from '../../features/pack/catalog';
import { CatalogProvider } from '../../app/CatalogContext';
import { Route, type ScreenProps } from '../../app/routes';
import { bundledPack } from '../../features/pack/bundledPack';
import { ARScreen } from './ARScreen';

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
const liveSample = {
  sampleTimestamp: 100,
  cameraTracking: 'normal',
  cameraFramesPerSecond: 60,
  objectAnchors: 0,
  trackedObjectAnchors: 0,
  allObjectAnchors: 0,
  sessionSeconds: 12,
  pinsEnabled: false,
};

describe('AR alignment screen', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const goBack = jest.fn();
  const node = (testID: string) => renderer.root.findByProps({ testID });
  const native = () =>
    renderer.root.findByType('ARGuideView' as React.ElementType);
  const event = async (state: string, message: string) => {
    await act(() => native().props.onTrackingStateChanged({ state, message }));
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

  test('changes the light without replacing the camera and reports actual hardware state', async () => {
    expect(node('ar-flash').props.disabled).toBe(true);
    const camera = native();
    const receive = camera.props.onTrackingStateChanged;
    await act(() =>
      receive({
        state: 'searching',
        message: 'Point at the engine.',
        torchAvailable: true,
        torchEnabled: false,
      }),
    );
    expect(node('ar-flash').props.disabled).toBe(false);
    await act(() => node('ar-flash').props.onPress());
    expect(native()).toBe(camera);
    expect(native().props.onTrackingStateChanged).toBe(receive);
    expect(native().props.torchEnabled).toBe(true);
    // A request alone must not make the UI claim the hardware light is on.
    expect(node('ar-flash').props.accessibilityState.selected).toBe(false);
    await act(() =>
      receive({
        state: 'searching',
        message: 'Point at the engine.',
        torchAvailable: true,
        torchEnabled: true,
      }),
    );
    expect(node('ar-flash').props.accessibilityState.selected).toBe(true);
    expect(node('ar-status').props.children).toBe('Looking for your engine');
    await act(() => node('ar-flash').props.onPress());
    expect(native().props.torchEnabled).toBe(false);
  });

  test('shows a light failure without claiming a recognition failure and resets it on retry', async () => {
    await act(() =>
      native().props.onTrackingStateChanged({
        state: 'limited',
        message: 'Move slowly.',
        torchAvailable: true,
        torchEnabled: false,
        torchError: 'Flash could not be changed.',
      }),
    );
    await act(() => node('ar-flash').props.onPress());
    expect(node('ar-flash-error').props.children).toBe(
      'Flash could not be changed.',
    );
    expect(node('ar-status').props.children).toBe(
      'Move slowly to find the engine',
    );
    await act(() => node('ar-retry').props.onPress());
    expect(native().props.torchEnabled).toBe(false);
    expect(node('ar-flash').props.disabled).toBe(true);
    expect(
      renderer.root.findAllByProps({ testID: 'ar-flash-error' }),
    ).toHaveLength(0);
  });

  test('retries a rejected light request on the next press', async () => {
    const receive = native().props.onTrackingStateChanged;
    const status = {
      state: 'searching',
      message: 'Point at the engine.',
      torchAvailable: true,
      torchEnabled: false,
    };
    await act(() => receive(status));
    await act(() => node('ar-flash').props.onPress());
    expect(native().props.torchEnabled).toBe(true);
    await act(() =>
      receive({ ...status, torchError: 'Flash could not be changed.' }),
    );
    expect(native().props.torchEnabled).toBe(false);
    await act(() => node('ar-flash').props.onPress());
    expect(native().props.torchEnabled).toBe(true);
    await act(() =>
      receive({ ...status, torchError: 'Flash could not be changed.' }),
    );
    expect(native().props.torchEnabled).toBe(false);
  });

  test('updates live readouts while searching without replacing or restarting the camera', async () => {
    const camera = native();
    const receive = camera.props.onTrackingStateChanged;
    await act(() =>
      receive({
        state: 'searching',
        message: 'Point at the engine.',
        referenceLoaded: true,
        telemetry: liveSample,
      }),
    );
    expect(node('ar-reference-state').props.children).toBe('Loaded');
    expect(node('ar-camera-state').props.children).toBe('Stable, 60 FPS');
    expect(node('ar-engine-state').props.children).toBe('0 found / 0 tracked');
    expect(node('ar-elapsed').props.children).toBe('00:12');
    // The state and message are unchanged; fresh frame metadata must still reach the HUD.
    await act(() =>
      receive({
        state: 'searching',
        message: 'Point at the engine.',
        referenceLoaded: true,
        telemetry: {
          ...liveSample,
          sampleTimestamp: 101,
          sessionSeconds: 13,
          cameraFramesPerSecond: 59,
        },
      }),
    );
    expect(node('ar-elapsed').props.children).toBe('00:13');
    expect(node('ar-camera-state').props.children).toBe('Stable, 59 FPS');
    expect(native()).toBe(camera);
    expect(native().props.onTrackingStateChanged).toBe(receive);
  });

  test('shows recognition, loss and pause without keeping stale camera measurements', async () => {
    const receive = native().props.onTrackingStateChanged;
    await act(() =>
      receive({
        state: 'tracking',
        message: 'Check the four points.',
        referenceLoaded: true,
        telemetry: {
          ...liveSample,
          objectAnchors: 1,
          trackedObjectAnchors: 1,
          allObjectAnchors: 1,
          pinsEnabled: true,
        },
      }),
    );
    expect(node('ar-engine-state').props.children).toBe('1 found / 1 tracked');
    await act(() =>
      receive({
        state: 'limited',
        message: 'Move slowly.',
        referenceLoaded: true,
        telemetry: {
          ...liveSample,
          sampleTimestamp: 101,
          cameraTracking: 'limited:excessiveMotion',
          objectAnchors: 1,
          allObjectAnchors: 1,
        },
      }),
    );
    expect(node('ar-engine-state').props.children).toBe('1 found / 0 tracked');
    expect(node('ar-camera-state').props.children).toBe('Move slowly, 60 FPS');
    await act(() =>
      receive({
        state: 'paused',
        message: 'AR paused.',
        referenceLoaded: true,
      }),
    );
    expect(node('ar-camera-state').props.children).toBe('Paused');
    expect(renderer.root.findAllByProps({ testID: 'ar-elapsed' })).toHaveLength(
      0,
    );
  });

  test('waits for camera metadata instead of inventing measurements', () => {
    expect(node('ar-camera-state').props.children).toBe('Waiting');
    expect(renderer.root.findAllByProps({ testID: 'ar-elapsed' })).toHaveLength(
      0,
    );
  });
});
