import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, IconName } from '../../../shared/ui/kit/Icon';
import {
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Radius,
  Space,
  Type,
} from '../../../shared/ui/theme';

const ICON_SIZE = 22;
const BUTTON_ICON_SIZE = 20;

function ToolCard({
  testID,
  icon,
  label,
  hint,
  selected = false,
  inline,
  onPress,
}: {
  testID: string;
  icon: IconName;
  label: string;
  hint: string;
  selected?: boolean;
  /** A button over the splat, icon beside its name, rather than a card in the sidebar. */
  inline: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        inline ? styles.button : styles.wide,
        selected && (inline ? styles.buttonSelected : styles.selected),
        pressed && styles.pressed,
      ]}
    >
      <Icon
        name={icon}
        size={inline ? BUTTON_ICON_SIZE : ICON_SIZE}
        color={selected ? Color.accent : Color.secondaryText}
      />
      <Text
        numberOfLines={1}
        style={[
          inline ? styles.buttonLabel : styles.label,
          selected && styles.labelSelected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export const ToolsLayout = {
  /** A row of cards atop the sidebar. */
  sidebar: 'sidebar',
  /** A row of buttons over the splat, placed by the screen. */
  floating: 'floating',
} as const;
export type ToolsLayout = (typeof ToolsLayout)[keyof typeof ToolsLayout];

interface Props {
  exploring: boolean;
  onGuide: () => void;
  onExplore: () => void;
  layout: ToolsLayout;
  /** The splat has the screen, with the sidebar folded into buttons over it. */
  fullView?: boolean;
  /** Absent where there is no sidebar to fold away. */
  onFullView?: () => void;
}

/** How to work the capture: follow the guide step by step, or look around it freely. */
export function ViewerTools({
  exploring,
  onGuide,
  onExplore,
  layout,
  fullView = false,
  onFullView,
}: Props) {
  const inline = layout === ToolsLayout.floating;
  return (
    <View testID="viewer-tools" style={styles[layout]}>
      <ToolCard
        testID="tool-guide"
        icon={IconName.list}
        label="Guide"
        hint="Follow the procedure step by step"
        selected={!exploring}
        inline={inline}
        onPress={onGuide}
      />
      <ToolCard
        testID="tool-explore"
        icon={IconName.explore}
        label="Explore"
        hint="Move freely and select any part"
        selected={exploring}
        inline={inline}
        onPress={onExplore}
      />
      {onFullView !== undefined && (
        <ToolCard
          testID="tool-full-view"
          icon={IconName.frame}
          label="Full view"
          hint={
            fullView ? 'Show the sidebar' : 'Give the splat the whole screen'
          }
          selected={fullView}
          inline={inline}
          onPress={onFullView}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
  },
  floating: { flexDirection: 'row', gap: Space.sm },
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    backgroundColor: Color.surface,
  },
  wide: { flex: 1, paddingVertical: Space.md },
  // Solid, so the button reads the same over any part of the capture.
  button: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    borderColor: Color.lineStrong,
    backgroundColor: Color.raised,
  },
  selected: { borderColor: Color.accent, backgroundColor: Color.accentWash },
  buttonSelected: { borderColor: Color.accent },
  pressed: { backgroundColor: Color.pressed },
  label: { ...Type.label, color: Color.muted },
  buttonLabel: { ...Type.calloutStrong, color: Color.secondaryText },
  labelSelected: { color: Color.text },
});
