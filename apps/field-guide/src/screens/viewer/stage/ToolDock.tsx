import { useRef, useState, type ComponentRef } from 'react';
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

export const TOOL_DIAMETER = 48;
const ICON_SIZE = 20;
const PRESSED_SCALE = 0.94;
const ACTIVE_RING = 1.5;
const DISABLED_OPACITY = 0.4;
const HELP_WIDTH = 280;
const ToolCopy = {
  recenter: 'Recenter view',
  labels: 'Part labels',
  repeat: 'Repeat step',
  help: 'Help',
  fullView: 'Full view',
  dismissHelp: 'Dismiss help',
  recenterHint: 'Return to the starting view',
  labelsOnHint: 'Hide part labels',
  labelsOffHint: 'Show part labels',
  repeatHint: 'Hear the current step again',
  helpHint: 'Show how to move around the picture',
  dismissHelpHint: 'Return to the viewer',
  fullViewOnHint: 'Show the drawer',
  fullViewOffHint: 'Give the picture the whole stage',
} as const;
const HELP_LINES = [
  'Drag to turn the model.',
  'Pinch to zoom.',
  'Tap a part to select it.',
] as const;
const FADE_IN = FadeIn.duration(Motion.base).reduceMotion(ReduceMotion.Never);
const FADE_OUT = FadeOut.duration(Motion.base).reduceMotion(ReduceMotion.Never);

interface Props {
  labelsOn: boolean;
  fullView: boolean;
  canRepeat: boolean;
  onRecenter: () => void;
  onToggleLabels: () => void;
  onRepeat: () => void;
  onToggleFullView: () => void;
}

interface ToolProps {
  icon: IconName;
  label: string;
  hint: string;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function Tool({
  icon,
  label,
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
      style={styles.touch}
    >
      <Animated.View style={[pressedStyle, disabled && styles.disabled]}>
        <Glass
          tone={GlassTone.clear}
          radius={Radius.round}
          style={[styles.button, selected && styles.active]}
        >
          <Icon
            name={icon}
            size={ICON_SIZE}
            color={selected ? Color.accentText : Color.text}
          />
        </Glass>
      </Animated.View>
    </Pressable>
  );
}

export function ToolDock({
  labelsOn,
  fullView,
  canRepeat,
  onRecenter,
  onToggleLabels,
  onRepeat,
  onToggleFullView,
}: Props) {
  const dock = useRef<ComponentRef<typeof View>>(null);
  const window = useWindowDimensions();
  const [helpAnchor, setHelpAnchor] = useState<{
    x: number;
    y: number;
    width: number;
  } | null>(null);
  const helpWidth = Math.min(
    HELP_WIDTH,
    Math.max(0, window.width - Space.lg * 2),
  );
  const dismissHelp = () => setHelpAnchor(null);
  const measureHelp = () => {
    dock.current?.measureInWindow((x, y, width) =>
      setHelpAnchor({ x, y, width }),
    );
  };
  const toggleHelp = () => {
    if (helpAnchor === null) {
      measureHelp();
    } else {
      dismissHelp();
    }
  };

  return (
    <View
      ref={dock}
      collapsable={false}
      testID="stage-tool-dock"
      role="toolbar"
      onLayout={() => {
        if (helpAnchor !== null) {
          measureHelp();
        }
      }}
      style={styles.dock}
    >
      <Tool
        icon={IconName.frame}
        label={ToolCopy.recenter}
        hint={ToolCopy.recenterHint}
        onPress={onRecenter}
      />
      <Tool
        icon={IconName.tag}
        label={ToolCopy.labels}
        hint={labelsOn ? ToolCopy.labelsOnHint : ToolCopy.labelsOffHint}
        selected={labelsOn}
        onPress={onToggleLabels}
      />
      <Tool
        icon={IconName.repeat}
        label={ToolCopy.repeat}
        hint={ToolCopy.repeatHint}
        disabled={!canRepeat}
        onPress={onRepeat}
      />
      <Tool
        icon={IconName.help}
        label={ToolCopy.help}
        hint={ToolCopy.helpHint}
        expanded={helpAnchor !== null}
        onPress={toggleHelp}
      />
      <Tool
        icon={IconName.sidebar}
        label={ToolCopy.fullView}
        hint={fullView ? ToolCopy.fullViewOnHint : ToolCopy.fullViewOffHint}
        selected={fullView}
        onPress={onToggleFullView}
      />
      <Modal
        visible={helpAnchor !== null}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="none"
        onRequestClose={dismissHelp}
        supportedOrientations={['portrait', 'landscape']}
      >
        <View
          style={styles.helpLayer}
          accessibilityViewIsModal
          onAccessibilityEscape={dismissHelp}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ToolCopy.dismissHelp}
            accessibilityHint={ToolCopy.dismissHelpHint}
            accessibilityState={{ disabled: false }}
            onPress={dismissHelp}
            style={StyleSheet.absoluteFill}
          />
          {helpAnchor !== null && (
            <Animated.View
              entering={FADE_IN}
              exiting={FADE_OUT}
              style={[
                styles.popover,
                {
                  width: helpWidth,
                  left: Math.max(
                    Space.lg,
                    Math.min(
                      helpAnchor.x + (helpAnchor.width - helpWidth) / 2,
                      window.width - helpWidth - Space.lg,
                    ),
                  ),
                  bottom: Math.max(
                    Space.lg,
                    window.height - helpAnchor.y + Space.md,
                  ),
                },
              ]}
            >
              <Glass
                tone={GlassTone.strong}
                radius={Radius.card}
                style={styles.helpContent}
              >
                {HELP_LINES.map(line => (
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
  dock: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  touch: { width: TOOL_DIAMETER, height: TOOL_DIAMETER },
  button: {
    width: TOOL_DIAMETER,
    height: TOOL_DIAMETER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: {
    backgroundColor: Color.accentFill,
    borderWidth: ACTIVE_RING,
    borderColor: Color.accent,
  },
  disabled: { opacity: DISABLED_OPACITY },
  helpLayer: { flex: 1 },
  popover: { position: 'absolute' },
  helpContent: { padding: Space.lg, gap: Space.sm },
  helpLine: { ...Type.callout, color: Color.text },
});
