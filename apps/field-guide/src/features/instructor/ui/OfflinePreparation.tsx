import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import type { OfflineModels } from 'react-native-on-device';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';
import { instructorStore } from '../state/instructorStore';

const BYTES_PER_GIGABYTE = 1_000_000_000;

function Preparation({
  models,
  offline,
  showReady,
  detailed,
}: {
  models: OfflineModels;
  offline: boolean;
  showReady: boolean;
  detailed: boolean;
}) {
  const status = useSyncExternalStore(models.subscribe, models.getSnapshot);
  const ready = status.state === 'ready';
  if (ready && !showReady && !detailed) {
    return null;
  }
  const downloading = status.state === 'downloading';
  const checking = status.state === 'checking';
  const label = ready
    ? 'Models ready'
    : checking
    ? 'Checking models…'
    : offline
    ? 'Connect to prepare models'
    : downloading
    ? `Downloading models ${Math.floor(status.progress * 100)}%`
    : status.state === 'error'
    ? 'Model preparation failed'
    : 'Models not ready';
  const action = downloading
    ? 'Pause'
    : status.state === 'error'
    ? 'Retry'
    : 'Continue';
  return (
    <View style={[styles.container, detailed && styles.card]}>
      {detailed && (
        <View style={styles.summary}>
          <Text accessibilityRole="header" style={styles.title}>
            Voice & AI
          </Text>
          <Text style={styles.models}>Qwen2.5 / Whisper / Kokoro</Text>
          <Text style={styles.detail}>
            {`English, ${(status.bytes / BYTES_PER_GIGABYTE).toFixed(1)} GB`}
          </Text>
        </View>
      )}
      <View style={styles.row}>
        <Text style={styles.detail} accessibilityLiveRegion="polite">
          {label}
        </Text>
        {!ready && !checking && !offline && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${action} model download`}
            onPress={() =>
              downloading ? models.cancel() : models.prepare().catch(() => {})
            }
            style={styles.action}
          >
            <Text style={styles.actionText}>{action}</Text>
          </Pressable>
        )}
      </View>
      {downloading && !offline && (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.floor(status.progress * 100),
          }}
          style={styles.track}
        >
          <View style={[styles.fill, { width: `${status.progress * 100}%` }]} />
        </View>
      )}
    </View>
  );
}
/** Observes the app-owned preparation; mounting a screen never starts a second download. */
export function OfflinePreparation({
  showReady = false,
  detailed = false,
}: {
  showReady?: boolean;
  /** Downloads card; shows the verified ready state as well as preparation progress. */
  detailed?: boolean;
}) {
  const instructor = useStore(instructorStore, state => state.instructor);
  const offline = useStore(instructorStore, state => !state.hasNetworkRoute);
  const models = instructor?.offlineModels;
  return models ? (
    <Preparation
      models={models}
      offline={offline}
      showReady={showReady}
      detailed={detailed}
    />
  ) : null;
}
const styles = StyleSheet.create({
  container: { gap: G.unit },
  card: {
    padding: G.medium,
    gap: G.small,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.card,
    backgroundColor: C.surface,
  },
  summary: { gap: G.unit },
  title: { ...T.heading, color: C.text },
  models: { ...T.body, color: C.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: G.small,
    flexWrap: 'wrap',
  },
  detail: { ...T.caption, color: C.secondary, flexShrink: 1 },
  action: {
    minHeight: G.control,
    paddingHorizontal: G.small,
    justifyContent: 'center',
    borderRadius: R.control,
  },
  actionText: { ...T.label, color: C.text },
  track: {
    height: G.unit,
    borderRadius: R.pill,
    backgroundColor: C.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: C.accent },
});
