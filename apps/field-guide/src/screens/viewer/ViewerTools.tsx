import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Radius,
  Space,
  Type,
} from '../../ui/theme';

// A segmented control's height, inside the 44 point touch target it is centred in.
const SEGMENTS_HEIGHT = 36;
const SEGMENT_INSET = 2;

function Segment({
  testID,
  label,
  hint,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected }}
      hitSlop={(MIN_TOUCH - SEGMENTS_HEIGHT) / 2}
      onPress={onPress}
      style={[styles.segment, selected && styles.selected]}
    >
      <Text style={[styles.label, selected && styles.selectedLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

interface Props {
  exploring: boolean;
  onGuide: () => void;
  onExplore: () => void;
}

export function ViewerTools({ exploring, onGuide, onExplore }: Props) {
  return (
    <View testID="viewer-tools" style={styles.tools}>
      <View style={styles.segments}>
        <Segment
          testID="tool-guide"
          label="Guide"
          hint="Follow the procedure step by step"
          selected={!exploring}
          onPress={onGuide}
        />
        <Segment
          testID="tool-explore"
          label="Explore"
          hint="Move freely and select any part"
          selected={exploring}
          onPress={onExplore}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tools: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  segments: {
    height: SEGMENTS_HEIGHT,
    flexDirection: 'row',
    padding: SEGMENT_INSET,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    backgroundColor: Color.overlay,
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderRadius: Radius.sm,
  },
  selected: { backgroundColor: Color.pressed },
  label: { ...Type.calloutStrong, color: Color.muted },
  selectedLabel: { color: Color.text },
});
