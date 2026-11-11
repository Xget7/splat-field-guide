import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import type { OfflineModels } from 'react-native-on-device';
import { Button, ButtonVariant } from '../../../ui/Button';
import { Color, Space, Type } from '../../../ui/theme';
import { instructorStore } from '../state/instructorStore';

function Preparation({ models }: { models: OfflineModels }) {
  const status = useSyncExternalStore(models.subscribe, models.getSnapshot);
  if (status.state === 'ready') {
    return null;
  }
  const downloading = status.state === 'downloading';
  const checking = status.state === 'checking';
  return (
    <View style={styles.container}>
      <Text style={styles.detail} accessibilityLiveRegion="polite">
        {checking
          ? 'Checking offline guide…'
          : downloading
          ? `Preparing offline guide: ${Math.floor(status.progress * 100)}%`
          : status.error
          ? 'Download interrupted. Retry to prepare the offline guide.'
          : `Prepare voice and answers for use without internet (${(
              status.bytes / 1e9
            ).toFixed(1)} GB).`}
      </Text>
      {!checking && (
        <Button
          label={downloading ? 'Cancel download' : 'Prepare offline'}
          variant={ButtonVariant.secondary}
          onPress={() => {
            if (downloading) {
              models.cancel();
            } else {
              models.prepare().catch(() => {});
            }
          }}
        />
      )}
    </View>
  );
}

export function OfflinePreparation() {
  const instructor = useStore(instructorStore, state => state.instructor);
  const models = instructor?.offlineModels;
  return models ? <Preparation models={models} /> : null;
}
const styles = StyleSheet.create({
  container: { gap: Space.sm, paddingVertical: Space.sm },
  detail: { ...Type.footnote, color: Color.secondaryText },
});
