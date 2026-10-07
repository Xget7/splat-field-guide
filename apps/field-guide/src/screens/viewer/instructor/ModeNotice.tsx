import { StyleSheet, Text } from 'react-native';
import { Color, Type } from '../../../ui/theme';
import type { Notice } from './useModeView';

export function ModeNotice({
  notice,
  titled = true,
}: {
  notice: Notice;
  titled?: boolean;
}) {
  return (
    <>
      {titled && <Text style={styles.title}>{notice.title}</Text>}
      <Text style={styles.detail}>{notice.detail}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  title: { ...Type.calloutStrong, color: Color.text },
  detail: { ...Type.footnote, color: Color.secondaryText },
});
