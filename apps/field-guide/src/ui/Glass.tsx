import { BlurView } from '@sbaiahmed1/react-native-blur';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { BLUR_AMOUNT, Color, HAIRLINE, Radius } from './theme';

export const GlassTone = {
  clear: 'clear',
  strong: 'strong',
} as const;
export type GlassTone = (typeof GlassTone)[keyof typeof GlassTone];

const TINT: Readonly<Record<GlassTone, string>> = {
  clear: Color.glass,
  strong: Color.glassStrong,
};

interface Props extends ViewProps {
  /** Strong carries reading text; clear suits controls. */
  tone?: GlassTone;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Dark frosted surface over the splat: a native blur, a tint for legibility and a hairline edge. */
export function Glass({
  tone = GlassTone.clear,
  radius = Radius.card,
  style,
  children,
  ...props
}: Props) {
  return (
    <View {...props} style={[styles.glass, { borderRadius: radius }, style]}>
      <BlurView
        blurType="dark"
        blurAmount={BLUR_AMOUNT}
        overlayColor={TINT[tone]}
        reducedTransparencyFallbackColor={Color.drawer}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: {
    overflow: 'hidden',
    borderWidth: HAIRLINE,
    borderColor: Color.glassLine,
  },
});
