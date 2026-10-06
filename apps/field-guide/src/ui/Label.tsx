import { StyleSheet, Text, type TextProps } from 'react-native';
import { Color, Type } from './theme';

export function Label({
  color = Color.muted,
  style,
  ...props
}: TextProps & { color?: string }) {
  return <Text {...props} style={[styles.label, { color }, style]} />;
}

const styles = StyleSheet.create({ label: Type.label });
