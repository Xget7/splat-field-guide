import { StyleSheet, Text } from 'react-native';
import { Color, Type } from '../../../ui/theme';
import { ModeBanner } from './ModeBanner';
import type { Notice } from './useModeView';

export function ModeNotice({ notice }: { notice: Notice | null }) {
  if (notice === null) {
    return null;
  }
  return (
    <ModeBanner ruleColor={notice.ruleColor}>
      <Text style={styles.title}>{notice.title}</Text>
      <Text style={styles.detail}>{notice.detail}</Text>
    </ModeBanner>
  );
}

const styles = StyleSheet.create({
  title: { ...Type.calloutStrong, color: Color.text },
  detail: { ...Type.footnote, color: Color.secondaryText },
});
