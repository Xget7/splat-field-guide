import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Line } from 'react-native-svg';
import { ModelPreview, Turns } from '../../../ui/ModelPreview';
import { Spotlight, SvgFill } from '../../../ui/Gradients';
import { Icon, IconName } from '../../../ui/Icon';
import { Color, HAIRLINE, Radius, Space, Type } from '../../../ui/theme';
import V8_CAPTURE from '../../../../assets/ar/v8-engine.json';

const Art = {
  height: 220,
  wideHeight: 260,
  wideShare: 0.46,
  // The turntable axis: a dashed centre line, as in a technical drawing.
  axisDash: '6 5',
  axisOpacity: 0.18,
  goIcon: 16,
  goHeight: 36,
  captionWidth: 420,
} as const;

const TITLE = 'Assemble a V8 in AR';
const CAPTION =
  'Place a V8 engine in your space and bring its pieces together, step by step.';

/** The library's entry to the V8 assembly tour, with its model turning beside the copy. */
export function AssemblyBanner({
  wide,
  onPress,
}: {
  wide: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID="open-ar-assembly"
      accessibilityRole="button"
      accessibilityLabel={TITLE}
      accessibilityHint={CAPTION}
      onPress={onPress}
      style={({ pressed }) => [
        styles.banner,
        wide && styles.bannerWide,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.copy, wide && styles.copyWide]}>
        <Text style={wide ? styles.titleWide : styles.title}>{TITLE}</Text>
        <Text style={styles.caption}>{CAPTION}</Text>
        <View style={styles.go}>
          <Text style={styles.goText}>Start</Text>
          <Icon name={IconName.next} size={Art.goIcon} color={Color.text} />
        </View>
      </View>
      <View
        pointerEvents="none"
        style={[styles.art, wide ? styles.artWide : { height: Art.height }]}
      >
        <Spotlight id="assembly-light" />
        <SvgFill>
          {({ width, height }) => (
            <Line
              x1={width / 2}
              y1={0}
              x2={width / 2}
              y2={height}
              stroke={Color.text}
              strokeOpacity={Art.axisOpacity}
              strokeWidth={HAIRLINE}
              strokeDasharray={Art.axisDash}
            />
          )}
        </SvgFill>
        <ModelPreview path={V8_CAPTURE.modelPath} turn={Turns.spin} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: Radius.frame,
    overflow: 'hidden',
    backgroundColor: Color.raised,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    // The art leads on a phone; on a tablet it sits to the right of the copy.
    flexDirection: 'column-reverse',
  },
  bannerWide: { flexDirection: 'row' },
  pressed: { backgroundColor: Color.pressed },
  copy: { padding: Space.lg, gap: Space.sm, alignItems: 'flex-start' },
  copyWide: { flex: 1, justifyContent: 'center', padding: Space.xxl },
  title: { ...Type.title, color: Color.text },
  titleWide: { ...Type.largeTitle, color: Color.text },
  caption: {
    ...Type.callout,
    color: Color.secondaryText,
    maxWidth: Art.captionWidth,
  },
  go: {
    marginTop: Space.sm,
    height: Art.goHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingLeft: Space.lg,
    paddingRight: Space.md,
    borderRadius: Radius.round,
    backgroundColor: Color.pressed,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
  },
  goText: { ...Type.calloutStrong, color: Color.text },
  art: { overflow: 'hidden' },
  artWide: { width: `${Art.wideShare * 100}%`, height: Art.wideHeight },
});
