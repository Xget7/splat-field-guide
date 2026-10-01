import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Color } from '../theme';

const DEFAULT_LENGTH = 14;
const DEFAULT_THICKNESS = 2;

interface Props {
  color?: string;
  /** Each arm of a corner, points. */
  length?: number;
  thickness?: number;
  style?: ViewStyle;
}

/** Four corner marks around the parent, like a sight's reticle. */
export function Brackets({
  color = Color.accent,
  length = DEFAULT_LENGTH,
  thickness = DEFAULT_THICKNESS,
  style,
}: Props) {
  const arm = { width: length, height: length, borderColor: color };
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <View
        style={[
          styles.corner,
          arm,
          styles.topLeft,
          { borderTopWidth: thickness, borderLeftWidth: thickness },
        ]}
      />
      <View
        style={[
          styles.corner,
          arm,
          styles.topRight,
          { borderTopWidth: thickness, borderRightWidth: thickness },
        ]}
      />
      <View
        style={[
          styles.corner,
          arm,
          styles.bottomLeft,
          { borderBottomWidth: thickness, borderLeftWidth: thickness },
        ]}
      />
      <View
        style={[
          styles.corner,
          arm,
          styles.bottomRight,
          { borderBottomWidth: thickness, borderRightWidth: thickness },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  corner: { position: 'absolute' },
  topLeft: { top: 0, left: 0 },
  topRight: { top: 0, right: 0 },
  bottomLeft: { bottom: 0, left: 0 },
  bottomRight: { bottom: 0, right: 0 },
});
