import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import type {
  OfflineModels,
  OfflineModelProgress,
} from 'react-native-on-device';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';
import { instructorStore } from '../state/instructorStore';

const GROUP_LABELS = {
  answers: 'Answers',
  listening: 'Listening',
  speaking: 'Speaking',
};

function groupStatus(group: OfflineModelProgress): string {
  switch (group.state) {
    case 'ready':
      return 'Ready';
    case 'checking':
      return 'Verifying…';
    case 'downloading':
      return `${Math.floor(group.progress * 100)}%`;
    case 'queued':
      return 'Queued';
    case 'error':
      return 'Download failed';
    case 'missing':
      return 'Not downloaded';
  }
}

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
  const action = downloading
    ? 'Pause'
    : status.state === 'error'
    ? 'Retry'
    : 'Download';
  return (
    <View style={[styles.container, detailed && styles.card]}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.title}>
          {detailed ? 'Voice & AI' : 'Offline tools'}
        </Text>
        {ready && <Text style={styles.detail}>Offline ready</Text>}
        {!ready && !checking && (downloading || !offline) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${action} offline tools`}
            onPress={() =>
              downloading ? models.cancel() : models.prepare().catch(() => {})
            }
            style={styles.action}
          >
            <Text style={styles.actionText}>{action}</Text>
          </Pressable>
        )}
      </View>
      {status.models.map(group => (
        <View key={group.id} testID={`offline-preparation-${group.id}`}>
          <View style={styles.row}>
            <Text style={styles.name}>{GROUP_LABELS[group.id]}</Text>
            <Text style={styles.detail} accessibilityLiveRegion="polite">
              {groupStatus(group)}
            </Text>
          </View>
          {group.state === 'downloading' && (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={`${GROUP_LABELS[group.id]} download`}
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.floor(group.progress * 100),
              }}
              style={styles.track}
            >
              <View
                style={[styles.fill, { width: `${group.progress * 100}%` }]}
              />
            </View>
          )}
        </View>
      ))}
      {offline && !ready && !checking && (
        <Text style={styles.detail}>Connect to download</Text>
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
  title: { ...T.heading, color: C.text },
  name: { ...T.caption, color: C.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
