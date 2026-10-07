import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Glass, GlassTone } from '../../../ui/Glass';
import { Icon, IconName } from '../../../ui/Icon';
import { Color, Motion, Radius, Space, Type } from '../../../ui/theme';
import { BOTTOM_BAND_HEIGHT } from '../shell/layout';

/** The tool row fills the bottom band, so it lines up with the collapsed assistant. */
export const TOOLS_HEIGHT = BOTTOM_BAND_HEIGHT;
const TOOL_WIDTH = 60;
const ICON_DIAMETER = 32;
const ICON_SIZE = 20;
const PRESSED_SCALE = 0.94;
const ACTIVE_RING = 1.5;
const DISABLED_OPACITY = 0.4;
const HELP_WIDTH = 280;
const DEV_WIDTH = 320;
const ToolCopy = {
  recenter: 'Recenter view',
  labels: 'Part labels',
  repeat: 'Repeat step',
  help: 'Help',
  dev: 'Developer details',
  fullView: 'Full view',
  recenterHint: 'Return to the starting view',
  labelsOnHint: 'Hide part labels',
  labelsOffHint: 'Show part labels',
  repeatHint: 'Hear the current step again',
  helpHint: 'Show how to move around the picture',
  devHint: 'Show what the app is running on',
  dismissHint: 'Return to the viewer',
  fullViewOnHint: 'Show the drawer',
  fullViewOffHint: 'Give the picture the whole stage',
} as const;
// Short names under the icons; the buttons keep their full accessibility labels.
const Caption = {
  recenter: 'Recenter',
  labels: 'Labels',
  repeat: 'Repeat',
  help: 'Help',
  dev: 'Dev',
  fullView: 'Full view',
} as const;
const HELP_LINES = [
  'Drag to turn the model.',
  'Pinch to zoom.',
  'Tap a part to select it.',
] as const;
const FADE_IN = FadeIn.duration(Motion.base).reduceMotion(ReduceMotion.Never);
const FADE_OUT = FadeOut.duration(Motion.base).reduceMotion(ReduceMotion.Never);

const Popover = { help: 'help', dev: 'dev' } as const;
type Popover = (typeof Popover)[keyof typeof Popover];
const POPOVER_WIDTH: Record<Popover, number> = {
  [Popover.help]: HELP_WIDTH,
  [Popover.dev]: DEV_WIDTH,
};
const DISMISS_LABEL: Record<Popover, string> = {
  [Popover.help]: 'Dismiss help',
  [Popover.dev]: 'Dismiss developer details',
};

interface Props {
  labelsOn: boolean;
  fullView: boolean;
  canRepeat: boolean;
  /** The Dev button's panel. */
  dev: ReactNode;
  onRecenter: () => void;
  onToggleLabels: () => void;
  onRepeat: () => void;
  onToggleFullView: () => void;
}

interface ToolProps {
  icon: IconName;
  label: string;
  caption: string;
  hint: string;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function Tool({
  icon,
  label,
  caption,
  hint,
  selected,
  expanded,
  disabled = false,
  onPress,
}: ToolProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const press = (pressed: boolean) => {
    scale.value = withTiming(pressed && !reducedMotion ? PRESSED_SCALE : 1, {
      duration: reducedMotion ? 0 : Motion.fast,
    });
  };
  const active = selected === true || expanded === true;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected, expanded, disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => press(true)}
      onPressOut={() => press(false)}
      style={styles.tool}
    >
      <Animated.View
        style={[styles.toolBody, pressedStyle, disabled && styles.disabled]}
      >
        <View style={[styles.icon, active && styles.active]}>
          <Icon
            name={icon}
            size={ICON_SIZE}
            color={active ? Color.accentText : Color.text}
          />
        </View>
        <Text
          style={[styles.caption, active && styles.activeCaption]}
          numberOfLines={1}
        >
          {caption}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export function ToolDock({
  labelsOn,
  fullView,
  canRepeat,
  dev,
  onRecenter,
  onToggleLabels,
  onRepeat,
  onToggleFullView,
}: Props) {
  const dock = useRef<ComponentRef<typeof View>>(null);
  const window = useWindowDimensions();
  const [popover, setPopover] = useState<{
    kind: Popover;
    x: number;
    y: number;
    width: number;
  } | null>(null);
  const popoverWidth = Math.min(
    popover === null ? HELP_WIDTH : POPOVER_WIDTH[popover.kind],
    Math.max(0, window.width - Space.lg * 2),
  );
  const dismiss = () => setPopover(null);
  const measure = (kind: Popover) => {
    dock.current?.measureInWindow((x, y, width) =>
      setPopover({ kind, x, y, width }),
    );
  };
  const toggle = (kind: Popover) => {
    if (popover?.kind === kind) {
      dismiss();
    } else {
      measure(kind);
    }
  };

  return (
    <View
      ref={dock}
      collapsable={false}
      testID="stage-tool-dock"
      role="toolbar"
      onLayout={() => {
        if (popover !== null) {
          measure(popover.kind);
        }
      }}
    >
      <Glass tone={GlassTone.strong} radius={Radius.card} style={styles.dock}>
        <Tool
          icon={IconName.frame}
          label={ToolCopy.recenter}
          caption={Caption.recenter}
          hint={ToolCopy.recenterHint}
          onPress={onRecenter}
        />
        <Tool
          icon={IconName.tag}
          label={ToolCopy.labels}
          caption={Caption.labels}
          hint={labelsOn ? ToolCopy.labelsOnHint : ToolCopy.labelsOffHint}
          selected={labelsOn}
          onPress={onToggleLabels}
        />
        <Tool
          icon={IconName.repeat}
          label={ToolCopy.repeat}
          caption={Caption.repeat}
          hint={ToolCopy.repeatHint}
          disabled={!canRepeat}
          onPress={onRepeat}
        />
        <Tool
          icon={IconName.help}
          label={ToolCopy.help}
          caption={Caption.help}
          hint={ToolCopy.helpHint}
          expanded={popover?.kind === Popover.help}
          onPress={() => toggle(Popover.help)}
        />
        <Tool
          icon={IconName.code}
          label={ToolCopy.dev}
          caption={Caption.dev}
          hint={ToolCopy.devHint}
          expanded={popover?.kind === Popover.dev}
          onPress={() => toggle(Popover.dev)}
        />
        <Tool
          icon={IconName.sidebar}
          label={ToolCopy.fullView}
          caption={Caption.fullView}
          hint={fullView ? ToolCopy.fullViewOnHint : ToolCopy.fullViewOffHint}
          selected={fullView}
          onPress={onToggleFullView}
        />
      </Glass>
      <Modal
        visible={popover !== null}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="none"
        onRequestClose={dismiss}
        supportedOrientations={['portrait', 'landscape']}
      >
        <View
          style={styles.layer}
          accessibilityViewIsModal
          onAccessibilityEscape={dismiss}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={DISMISS_LABEL[popover?.kind ?? Popover.help]}
            accessibilityHint={ToolCopy.dismissHint}
            accessibilityState={{ disabled: false }}
            onPress={dismiss}
            style={StyleSheet.absoluteFill}
          />
          {popover !== null && (
            <Animated.View
              entering={FADE_IN}
              exiting={FADE_OUT}
              style={[
                styles.popover,
                {
                  width: popoverWidth,
                  left: Math.max(
                    Space.lg,
                    Math.min(
                      popover.x + (popover.width - popoverWidth) / 2,
                      window.width - popoverWidth - Space.lg,
                    ),
                  ),
                  bottom: Math.max(
                    Space.lg,
                    window.height - popover.y + Space.md,
                  ),
                },
              ]}
            >
              <Glass
                tone={GlassTone.strong}
                radius={Radius.card}
                style={styles.popoverContent}
              >
                {popover.kind === Popover.dev
                  ? dev
                  : HELP_LINES.map(line => (
                      <Text key={line} style={styles.helpLine}>
                        {line}
                      </Text>
                    ))}
              </Glass>
            </Animated.View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    height: TOOLS_HEIGHT,
    paddingHorizontal: Space.xs,
  },
  tool: { width: TOOL_WIDTH, height: TOOLS_HEIGHT },
  toolBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xxs,
  },
  icon: {
    width: ICON_DIAMETER,
    height: ICON_DIAMETER,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: {
    backgroundColor: Color.accentFill,
    borderWidth: ACTIVE_RING,
    borderColor: Color.accent,
  },
  caption: { ...Type.caption, color: Color.secondaryText },
  activeCaption: { color: Color.text },
  disabled: { opacity: DISABLED_OPACITY },
  layer: { flex: 1 },
  popover: { position: 'absolute' },
  popoverContent: { padding: Space.lg, gap: Space.sm },
  helpLine: { ...Type.callout, color: Color.text },
});
