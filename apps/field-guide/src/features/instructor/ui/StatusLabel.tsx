import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Label } from '../../../ui/Label';
import { Color, Space } from '../../../ui/theme';
import {
  isLoading,
  statusToneFor,
  StatusTone,
  type AssistantStatus,
} from '../domain/instructorStatus';

const TONE_COLOR: Readonly<Record<StatusTone, string>> = {
  [StatusTone.quiet]: Color.secondaryText,
  [StatusTone.active]: Color.accent,
  [StatusTone.strong]: Color.text,
  [StatusTone.caution]: Color.caution,
};

export function statusColorFor(status: AssistantStatus): string {
  return TONE_COLOR[statusToneFor(status)];
}

/** The status word, with a spinner while the assistant connects. */
export function StatusLabel({
  status,
  id,
}: {
  status: AssistantStatus;
  id: string;
}) {
  const color = statusColorFor(status);
  return (
    <View style={styles.status}>
      <Label testID={id} accessibilityLiveRegion="polite" color={color}>
        {status}
      </Label>
      {isLoading(status) && (
        <ActivityIndicator
          testID="instructor-voice-loading"
          size="small"
          color={color}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
});
