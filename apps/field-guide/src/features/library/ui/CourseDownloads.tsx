import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import type { CourseDocuments } from '../../../platform/documents';
import { OfflinePreparation } from '../../instructor/views';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';

/** A catalog scene is not proof that the manual and all course modules are installed. */
export function CourseDownloads({
  sceneAvailable,
  onBack,
  documents,
  moduleCount = 0,
}: {
  sceneAvailable: boolean;
  onBack: () => void;
  documents?: CourseDocuments;
  moduleCount?: number;
}) {
  const [manuals, setManuals] = useState<string>('Checking local manuals');
  useEffect(() => {
    let active = true;
    const update = (value: string) => {
      if (active) setManuals(value);
    };
    setManuals('Checking local manuals');
    if (!documents) update('Not downloaded');
    else
      documents.list().then(
        entries =>
          update(
            entries.length > 0 && entries.every(entry => entry.available)
              ? 'Available on device'
              : 'Not downloaded',
          ),
        () => update('Could not verify local manuals'),
      );
    return () => {
      active = false;
    };
  }, [documents]);
  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.heading}>
        Downloads
      </Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.heading}>Automotive Assembly Line</Text>
          <Text style={styles.status}>Local demo resources</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>3D scene</Text>
          <Text style={styles.secondary}>
            {sceneAvailable ? 'Available' : 'Not downloaded'}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Equipment manuals</Text>
          <Text style={styles.secondary}>{manuals}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Course activities</Text>
          <Text style={styles.secondary}>
            {moduleCount > 0
              ? `${moduleCount} available on device`
              : 'Not downloaded'}
          </Text>
        </View>
        <Text style={styles.secondary}>
          Course downloads are not available yet.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to course"
          onPress={onBack}
          style={styles.action}
        >
          <Text style={styles.label}>Back to course</Text>
        </Pressable>
      </View>
      <OfflinePreparation detailed />
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: G.medium, maxWidth: 960 },
  card: {
    padding: G.medium,
    gap: G.medium,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.card,
    backgroundColor: C.surface,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: G.small,
  },
  heading: { ...T.heading, color: C.text },
  label: { ...T.label, color: C.text },
  secondary: { ...T.body, color: C.secondary },
  status: { ...T.caption, color: C.accent },
  action: {
    alignSelf: 'flex-start',
    minHeight: G.control,
    paddingHorizontal: G.small,
    justifyContent: 'center',
    backgroundColor: C.raised,
    borderRadius: R.control,
  },
});
