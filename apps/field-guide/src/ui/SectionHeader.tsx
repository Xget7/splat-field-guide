import { StyleSheet, Text, type TextStyle } from 'react-native';
import { Color, Type } from './theme';

/** A section's name, as a plain heading. */
export function SectionHeader({
  title,
  style,
}: {
  title: string;
  style?: TextStyle;
}) {
  return (
    <Text accessibilityRole="header" style={[styles.title, style]}>
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: { ...Type.headline, color: Color.text },
});
