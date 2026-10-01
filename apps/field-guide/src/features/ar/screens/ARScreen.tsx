import { useCallback, useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callback } from 'react-native-nitro-modules';
import { ARGuideView } from 'react-native-splat';
import landmarks from '../../../../assets/ar/landmarks.json';
import { findReadyGuide } from '../../../modules/catalog/catalog';
import { useCatalog } from '../../../modules/catalog/CatalogContext';
import { Route, type ScreenProps } from '../../../shared/navigation/routes';
import {
  Button,
  ButtonVariant,
  IconButton,
  IconButtonVariant,
} from '../../../shared/ui/kit/Button';
import { IconName } from '../../../shared/ui/kit/Icon';
import { Label } from '../../../shared/ui/kit/Label';
import { Color, Radius, Space, Type } from '../../../shared/ui/theme';

import {
  INITIAL_EVENT,
  parseEvent,
  pinColor,
  STATUS,
  type TrackingEvent,
} from '../model/tracking';

const AR_RESOURCE_BASE = 'ar/gol-trend-engine-bay/';

export function ARScreen({ navigation, route }: ScreenProps<typeof Route.ar>) {
  const guide = findReadyGuide(useCatalog(), route.params.guideId);
  const insets = useSafeAreaInsets();
  const [event, setEvent] = useState<TrackingEvent>(INITIAL_EVENT);
  const [attempt, setAttempt] = useState(0);
  const receive = useCallback((json: string) => {
    const next = parseEvent(json);
    if (next !== null) {
      setEvent(current =>
        current.state === next.state && current.message === next.message
          ? current
          : next,
      );
    }
  }, []);
  const trackingCallback = useMemo(() => callback(receive), [receive]);
  const retry = () => {
    setEvent(INITIAL_EVENT);
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

  return (
    <View testID="ar-screen" style={styles.root}>
      {supportedPlatform && readyGuide && (
        <ARGuideView
          key={attempt}
          testID="ar-camera"
          style={StyleSheet.absoluteFill}
          referencePath={`${AR_RESOURCE_BASE}engine-bay.referenceobject`}
          landmarksPath={`${AR_RESOURCE_BASE}landmarks.json`}
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
          <Label color={Color.accent}>AR alignment check</Label>
          <Text style={styles.title}>
            {guide?.title ?? 'Guide unavailable'}
          </Text>
        </View>
      </View>
      <View
        style={[styles.bottom, { paddingBottom: insets.bottom + Space.md }]}
      >
        <ScrollView contentContainerStyle={styles.panel}>
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
          </View>
          <Text testID="ar-message" style={styles.message}>
            {message}
          </Text>
          {readyGuide && (
            <>
              <View style={styles.legend}>
                {landmarks.landmarks.map((landmark, index) => (
                  <View key={landmark.id} style={styles.legendRow}>
                    <View
                      style={[
                        styles.pin,
                        { backgroundColor: pinColor(landmark.color) },
                      ]}
                    />
                    <Text style={styles.legendText}>
                      {`${index + 1}. ${landmark.label}`}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={styles.hint}>
                Move around the engine. Each marker should stay on its matching
                feature.
              </Text>
            </>
          )}
          {state === 'permission-denied' && (
            <Button
              testID="ar-settings"
              label="Open camera settings"
              onPress={() => {
                Linking.openSettings().catch(() => {
                  setEvent({
                    state: 'error',
                    message:
                      'Open Settings and enable camera access for Field Guide.',
                  });
                });
              }}
            />
          )}
          {supportedPlatform &&
            readyGuide &&
            ['error', 'limited'].includes(state) && (
              <Button
                testID="ar-retry"
                label="Find the engine again"
                variant={ButtonVariant.secondary}
                onPress={retry}
              />
            )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.black },
  top: { paddingHorizontal: Space.lg, gap: Space.lg },
  heading: {
    gap: Space.xs,
    alignSelf: 'flex-start',
    backgroundColor: Color.overlay,
    padding: Space.md,
    borderRadius: Radius.md,
  },
  title: { ...Type.headline, color: Color.text },
  bottom: {
    position: 'absolute',
    left: Space.lg,
    right: Space.lg,
    bottom: 0,
    maxHeight: '55%',
  },
  panel: {
    gap: Space.md,
    padding: Space.lg,
    backgroundColor: Color.overlay,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.lineStrong,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  status: { ...Type.headline, flex: 1, color: Color.text },
  message: { ...Type.callout, color: Color.secondaryText },
  legend: { gap: Space.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  pin: { width: 10, height: 10, borderRadius: 5 },
  legendText: { ...Type.footnote, flex: 1, color: Color.text },
  hint: { ...Type.footnote, color: Color.muted },
});
