import { useCallback, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callback } from 'react-native-nitro-modules';
import { ARPlacementView, type ARPlacementEvent } from 'react-native-splat';
import { findReadyGuide } from '../../features/pack/catalog';
import { useCatalog } from '../../app/CatalogContext';
import { Route, type ScreenProps } from '../../app/routes';
import {
  Button,
  ButtonVariant,
  IconButton,
  IconButtonVariant,
} from '../../ui/Button';
import { IconName } from '../../ui/Icon';
import { Color, Radius, Space, Type } from '../../ui/theme';

const MODEL_PATH = 'ar/gol-trend-engine-bay/engine-bay.usdz';
const DEFAULT_SCALE = 0.25;
const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
const SCALE_FACTOR = 1.25;
const INITIAL_EVENT: ARPlacementEvent = {
  state: 'loading',
  message: 'Preparing the engine and camera.',
  scale: DEFAULT_SCALE,
  placed: false,
};
const STATUS: Record<ARPlacementEvent['state'], string> = {
  loading: 'Preparing AR',
  'requesting-permission': 'Camera access',
  'permission-denied': 'Camera access needed',
  unsupported: 'AR needs a physical device',
  searching: 'Find a flat surface',
  ready: 'Ready to place',
  placed: 'Engine placed',
  limited: 'Restore tracking',
  paused: 'AR paused',
  error: 'AR unavailable',
};

export function ARPlacementScreen({
  navigation,
  route,
}: ScreenProps<typeof Route.placement>) {
  const guide = findReadyGuide(useCatalog(), route.params.guideId);
  const insets = useSafeAreaInsets();
  const [event, setEvent] = useState(INITIAL_EVENT);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [scaleRequest, setScaleRequest] = useState(0);
  const [placementRequest, setPlacementRequest] = useState(0);
  const [resetRequest, setResetRequest] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const receive = useCallback((next: ARPlacementEvent) => setEvent(next), []);
  const onPlacementChanged = useMemo(() => callback(receive), [receive]);
  const supported = Platform.OS === 'ios';
  const available = guide?.pack.packId === 'gol-trend-engine-bay';
  const state = supported ? event.state : 'unsupported';
  const canResize =
    available && ['ready', 'placed', 'searching'].includes(state);
  const message = !available
    ? 'This guide does not have a spatial capture yet.'
    : !supported
    ? 'Use an iPhone or iPad to view the engine in your space.'
    : event.message;
  const resize = (next: number) => {
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
    setScaleRequest(current => current + 1);
  };
  const retry = () => {
    setEvent(INITIAL_EVENT);
    setScale(DEFAULT_SCALE);
    setScaleRequest(0);
    setPlacementRequest(0);
    setResetRequest(0);
    setAttempt(current => current + 1);
  };

  return (
    <View testID="ar-placement-screen" style={styles.root}>
      {supported && available && (
        <ARPlacementView
          key={attempt}
          testID="ar-placement-camera"
          style={StyleSheet.absoluteFill}
          modelPath={MODEL_PATH}
          scale={scale}
          scaleRequest={scaleRequest}
          placementRequest={placementRequest}
          resetRequest={resetRequest}
          onPlacementChanged={onPlacementChanged}
        />
      )}
      <View style={[styles.top, { paddingTop: insets.top + Space.sm }]}>
        <IconButton
          testID="ar-placement-back"
          icon={IconName.back}
          variant={IconButtonVariant.overlay}
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
        />
        <View style={styles.heading}>
          <Text style={styles.mode}>AR / YOUR SPACE</Text>
          <Text style={styles.title}>
            {guide?.title ?? 'Guide unavailable'}
          </Text>
        </View>
      </View>
      {available && !event.placed && ['searching', 'ready'].includes(state) && (
        <View pointerEvents="none" style={styles.targetArea}>
          <View
            testID="ar-placement-target"
            style={[styles.target, state === 'ready' && styles.targetReady]}
          />
        </View>
      )}
      <View
        style={[styles.bottom, { paddingBottom: insets.bottom + Space.md }]}
      >
        <View style={styles.panel}>
          <Text
            testID="ar-placement-status"
            accessibilityLiveRegion="polite"
            style={styles.title}
          >
            {available ? STATUS[state] : 'Capture unavailable'}
          </Text>
          <Text testID="ar-placement-message" style={styles.message}>
            {message}
          </Text>
          {canResize && (
            <View style={styles.scaleRow}>
              <Button
                testID="ar-placement-smaller"
                label="Smaller"
                variant={ButtonVariant.secondary}
                disabled={event.scale <= MIN_SCALE}
                onPress={() => resize(event.scale / SCALE_FACTOR)}
                style={styles.scaleButton}
              />
              <Text testID="ar-placement-scale" style={styles.scale}>
                {Math.round(event.scale * 100)}%
              </Text>
              <Button
                testID="ar-placement-larger"
                label="Larger"
                variant={ButtonVariant.secondary}
                disabled={event.scale >= MAX_SCALE}
                onPress={() => resize(event.scale * SCALE_FACTOR)}
                style={styles.scaleButton}
              />
            </View>
          )}
          {available &&
            ['searching', 'ready'].includes(state) &&
            !event.placed && (
              <Button
                testID="ar-placement-place"
                label="Place engine"
                disabled={state !== 'ready'}
                onPress={() => setPlacementRequest(current => current + 1)}
              />
            )}
          {event.placed && (
            <Button
              testID="ar-placement-reset"
              label="Place somewhere else"
              onPress={() => setResetRequest(current => current + 1)}
            />
          )}
          {state === 'permission-denied' && (
            <Button
              testID="ar-placement-settings"
              label="Open camera settings"
              onPress={() => {
                Linking.openSettings().catch(() =>
                  setEvent({
                    ...event,
                    state: 'error',
                    message:
                      'Open Settings and enable camera access for Field Guide.',
                  }),
                );
              }}
            />
          )}
          {available && state === 'error' && (
            <Button
              testID="ar-placement-retry"
              label="Try again"
              onPress={retry}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.black },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
  },
  heading: {
    flex: 1,
    gap: Space.xs,
    backgroundColor: Color.overlay,
    padding: Space.sm,
    borderRadius: Radius.sm,
  },
  mode: { ...Type.data, color: Color.muted, fontSize: 10 },
  title: { ...Type.calloutStrong, color: Color.text },
  targetArea: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  target: {
    width: 36,
    height: 36,
    borderWidth: 2,
    borderColor: Color.secondaryText,
    borderRadius: Radius.md,
  },
  targetReady: { borderColor: Color.accent, backgroundColor: Color.accentWash },
  bottom: { position: 'absolute', bottom: 0, left: Space.lg, right: Space.lg },
  panel: {
    padding: Space.md,
    gap: Space.sm,
    backgroundColor: Color.overlay,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.lineStrong,
  },
  message: { ...Type.footnote, color: Color.secondaryText },
  scaleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  scaleButton: { flex: 1 },
  scale: { ...Type.data, color: Color.text, minWidth: 44, textAlign: 'center' },
});
