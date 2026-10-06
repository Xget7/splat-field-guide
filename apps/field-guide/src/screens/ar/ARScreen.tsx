import { useCallback, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callback } from 'react-native-nitro-modules';
import { ARGuideView } from 'react-native-splat';
import { findReadyGuide } from '../../pack/catalog';
import { useCatalog } from '../../app/CatalogContext';
import { Route, type ScreenProps } from '../../app/routes';
import { Button, IconButton, IconButtonVariant } from '../../ui/Button';
import { IconName } from '../../ui/Icon';
import { Color, Radius, Space, Type } from '../../ui/theme';

import {
  CAMERA_STATUS,
  elapsedTime,
  INITIAL_EVENT,
  STATUS,
  type TrackingEvent,
} from './tracking';

const AR_RESOURCE_BASE = 'ar/gol-trend-engine-bay/';

export function ARScreen({ navigation, route }: ScreenProps<typeof Route.ar>) {
  const guide = findReadyGuide(useCatalog(), route.params.guideId);
  const insets = useSafeAreaInsets();
  const [event, setEvent] = useState<TrackingEvent>(INITIAL_EVENT);
  const [attempt, setAttempt] = useState(0);
  const [torchRequested, setTorchRequested] = useState(false);
  const receive = useCallback((next: TrackingEvent) => {
    if (next.torchError) {
      setTorchRequested(next.torchEnabled);
    }
    setEvent(current =>
      current.state === next.state &&
      current.message === next.message &&
      current.torchAvailable === next.torchAvailable &&
      current.torchEnabled === next.torchEnabled &&
      current.torchError === next.torchError &&
      current.referenceLoaded === next.referenceLoaded &&
      current.telemetry?.sampleTimestamp === next.telemetry?.sampleTimestamp
        ? current
        : next,
    );
  }, []);
  const trackingCallback = useMemo(() => callback(receive), [receive]);
  const retry = () => {
    setEvent(INITIAL_EVENT);
    setTorchRequested(false);
    setAttempt(current => current + 1);
  };
  const supportedPlatform = Platform.OS === 'ios';
  const readyGuide = guide?.pack.packId === 'gol-trend-engine-bay';
  const state = supportedPlatform ? event.state : 'unsupported';
  const message = !readyGuide
    ? 'This guide does not have an AR reference yet.'
    : !supportedPlatform
    ? 'Use an iPhone with iOS 27 or later for this check.'
    : event.message;
  const live = event.telemetry;
  const cameraStatus = live
    ? CAMERA_STATUS[live.cameraTracking]
    : state === 'paused'
    ? 'Paused'
    : ['unsupported', 'permission-denied', 'error'].includes(state)
    ? 'Not running'
    : 'Waiting';

  return (
    <View testID="ar-screen" style={styles.root}>
      {supportedPlatform && readyGuide && (
        <ARGuideView
          key={attempt}
          testID="ar-camera"
          style={StyleSheet.absoluteFill}
          referencePath={`${AR_RESOURCE_BASE}engine-bay.referenceobject`}
          landmarksPath={`${AR_RESOURCE_BASE}landmarks.json`}
          torchEnabled={torchRequested}
          onTrackingStateChanged={trackingCallback}
        />
      )}
      <View
        style={[styles.top, { paddingTop: insets.top + Space.sm }]}
        pointerEvents="box-none"
      >
        <IconButton
          testID="ar-back"
          icon={IconName.back}
          variant={IconButtonVariant.overlay}
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
        />
        <View style={styles.heading}>
          <Text style={styles.mode}>AR / ENGINE ALIGNMENT</Text>
          <Text style={styles.title} numberOfLines={1}>
            {guide?.title ?? 'Guide unavailable'}
          </Text>
        </View>
        <IconButton
          testID="ar-flash"
          icon={IconName.flash}
          variant={
            event.torchEnabled
              ? IconButtonVariant.active
              : IconButtonVariant.overlay
          }
          accessibilityLabel={
            event.torchEnabled ? 'Turn flash off' : 'Turn flash on'
          }
          accessibilityState={{
            disabled: !event.torchAvailable,
            selected: !!event.torchEnabled,
          }}
          disabled={!event.torchAvailable}
          onPress={() => setTorchRequested(current => !current)}
        />
      </View>
      <View
        style={[styles.bottom, { paddingBottom: insets.bottom + Space.md }]}
      >
        <View style={styles.panel}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    state === 'tracking' ? Color.accent : Color.caution,
                },
              ]}
            />
            <Text
              testID="ar-status"
              accessibilityLiveRegion="polite"
              style={styles.status}
            >
              {readyGuide ? STATUS[state] : 'AR reference unavailable'}
            </Text>
            {live && (
              <Text testID="ar-elapsed" style={styles.elapsed}>
                {elapsedTime(live.sessionSeconds)}
              </Text>
            )}
            {supportedPlatform &&
              readyGuide &&
              ['error', 'limited'].includes(state) && (
                <IconButton
                  testID="ar-retry"
                  icon={IconName.repeat}
                  variant={IconButtonVariant.overlay}
                  accessibilityLabel="Find the engine again"
                  onPress={retry}
                />
              )}
          </View>
          <Text testID="ar-message" style={styles.message}>
            {message}
          </Text>
          <View style={styles.readouts}>
            <View style={styles.readoutRow}>
              <Text style={styles.readoutLabel}>REFERENCE</Text>
              <Text testID="ar-reference-state" style={styles.readoutValue}>
                {event.referenceLoaded === true
                  ? 'Loaded'
                  : event.referenceLoaded === false
                  ? 'Not loaded'
                  : 'Waiting'}
              </Text>
            </View>
            <View style={styles.readoutRow}>
              <Text style={styles.readoutLabel}>CAMERA</Text>
              <Text testID="ar-camera-state" style={styles.readoutValue}>
                {live
                  ? `${cameraStatus}, ${Math.round(
                      live.cameraFramesPerSecond,
                    )} FPS`
                  : cameraStatus}
              </Text>
            </View>
            <View style={styles.readoutRow}>
              <Text style={styles.readoutLabel}>ENGINE</Text>
              <Text testID="ar-engine-state" style={styles.readoutValue}>
                {live
                  ? `${live.objectAnchors} found / ${live.trackedObjectAnchors} tracked`
                  : 'Waiting for camera'}
              </Text>
            </View>
            {live && live.allObjectAnchors > live.objectAnchors && (
              <Text testID="ar-other-objects" style={styles.flashError}>
                ARKit objects: {live.allObjectAnchors}; engine matches:{' '}
                {live.objectAnchors}
              </Text>
            )}
          </View>
          {event.torchError && (
            <Text testID="ar-flash-error" style={styles.flashError}>
              {event.torchError}
            </Text>
          )}
          {state === 'permission-denied' && (
            <Button
              testID="ar-settings"
              label="Open camera settings"
              onPress={() => {
                Linking.openSettings().catch(() => {
                  setEvent({
                    ...INITIAL_EVENT,
                    state: 'error',
                    message:
                      'Open Settings and enable camera access for Field Guide.',
                  });
                });
              }}
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
    paddingHorizontal: Space.lg,
    gap: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heading: {
    gap: Space.xs,
    flex: 1,
    backgroundColor: Color.overlay,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.sm,
    borderRadius: Radius.sm,
  },
  mode: { ...Type.data, fontSize: 10, color: Color.muted, letterSpacing: 0.6 },
  title: { ...Type.data, color: Color.text },
  bottom: {
    position: 'absolute',
    left: Space.lg,
    right: Space.lg,
    bottom: 0,
  },
  panel: {
    gap: Space.xs,
    padding: Space.md,
    backgroundColor: Color.overlay,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.lineStrong,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  statusDot: { width: 4, height: 12 },
  status: { ...Type.data, flex: 1, color: Color.text },
  message: { ...Type.footnote, color: Color.secondaryText },
  flashError: { ...Type.footnote, color: Color.caution },
  elapsed: { ...Type.data, color: Color.muted, fontVariant: ['tabular-nums'] },
  readouts: {
    marginTop: Space.sm,
    paddingTop: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.lineStrong,
    gap: Space.xs,
  },
  readoutRow: { flexDirection: 'row', alignItems: 'baseline', gap: Space.sm },
  readoutLabel: { ...Type.data, color: Color.muted, fontSize: 10, width: 76 },
  readoutValue: { ...Type.data, color: Color.secondaryText, flex: 1 },
});
