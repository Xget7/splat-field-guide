import { StyleSheet, Text, type TextStyle } from 'react-native';
import { Color, Font, Type } from '../../../ui/theme';

interface ReplyTextProps {
  id: string;
  text: string;
  leadLength?: number;
  style?: TextStyle;
  numberOfLines?: number;
  accessibilityLabel?: string;
}

export function ReplyText({
  id,
  text,
  leadLength = 0,
  style,
  numberOfLines,
  accessibilityLabel = text,
}: ReplyTextProps) {
  return (
    <Text
      testID={id}
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={[styles.reply, style]}
    >
      {leadLength === 0 ? (
        text
      ) : (
        <>
          <Text style={styles.lead}>{text.slice(0, leadLength)}</Text>
          {text.slice(leadLength)}
        </>
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  reply: { ...Type.body, color: Color.text },
  lead: { fontFamily: Font.semiBold },
});
