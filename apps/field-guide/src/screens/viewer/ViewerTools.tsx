import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton, IconButtonVariant } from '../../ui/Button';
import { IconName } from '../../ui/Icon';
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
  fitted,
  onPress,
}: {
  testID: string;
  label: string;
  hint: string;
  selected: boolean;
  fitted: boolean;
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
      style={[
        styles.segment,
        !fitted && styles.shared,
        selected && styles.selected,
      ]}
    >
      <Text style={[styles.label, selected && styles.selectedLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

export const ToolsLayout = {
  sidebar: 'sidebar',
  floating: 'floating',
} as const;
export type ToolsLayout = (typeof ToolsLayout)[keyof typeof ToolsLayout];

interface Props {
  exploring: boolean;
  onGuide: () => void;
  onExplore: () => void;
  layout: ToolsLayout;
  fullView?: boolean;
  /** Absent where there is no sidebar to fold away. */
  onFullView?: () => void;
}

export function ViewerTools({
  exploring,
  onGuide,
  onExplore,
  layout,
  fullView = false,
  onFullView,
}: Props) {
  const floating = layout === ToolsLayout.floating;
  return (
    <View testID="viewer-tools" style={styles[layout]}>
      <View style={[styles.segments, floating && styles.floatingSegments]}>
        <Segment
          testID="tool-guide"
          label="Guide"
          hint="Follow the procedure step by step"
          selected={!exploring}
          fitted={floating}
          onPress={onGuide}
        />
        <Segment
          testID="tool-explore"
          label="Explore"
          hint="Move freely and select any part"
          selected={exploring}
          fitted={floating}
          onPress={onExplore}
        />
      </View>
      {onFullView !== undefined && (
        <IconButton
          testID="tool-full-view"
          icon={IconName.frame}
          accessibilityLabel="Full view"
          accessibilityHint={
            fullView ? 'Show the sidebar' : 'Give the splat the whole screen'
          }
          accessibilityState={{ selected: fullView }}
          variant={
            fullView
              ? IconButtonVariant.active
              : floating
              ? IconButtonVariant.overlay
              : IconButtonVariant.raised
          }
          size={SEGMENTS_HEIGHT}
          onPress={onFullView}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
  },
  floating: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  segments: {
    flex: 1,
    height: SEGMENTS_HEIGHT,
    flexDirection: 'row',
    padding: SEGMENT_INSET,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    backgroundColor: Color.surface,
  },
  floatingSegments: { flex: 0, backgroundColor: Color.overlay },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderRadius: Radius.sm,
  },
  shared: { flex: 1 },
  selected: { backgroundColor: Color.pressed },
  label: { ...Type.calloutStrong, color: Color.muted },
  selectedLabel: { color: Color.text },
});
