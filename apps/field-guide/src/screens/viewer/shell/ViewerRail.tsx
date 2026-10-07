import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, IconName } from '../../../ui/Icon';
import { Color, MIN_TOUCH, Radius, Space } from '../../../ui/theme';
import { Capability, RAIL_WIDTH } from './layout';

const BACK_LABEL = 'Back to guides';
const BACK_HINT = 'Return to the library';
const OPEN_HINT = 'Open panel';
const CLOSE_HINT = 'Close panel';
const CAPABILITIES = [
  { value: Capability.guide, label: 'Guide', icon: IconName.list },
  { value: Capability.explore, label: 'Explore', icon: IconName.explore },
] as const;

interface Props {
  topInset: number;
  bottomInset: number;
  capability: Capability;
  drawerOpen: boolean;
  onBack: () => void;
  onCapability: (capability: Capability) => void;
}

export function ViewerRail({
  topInset,
  bottomInset,
  capability,
  drawerOpen,
  onBack,
  onCapability,
}: Props) {
  return (
    <View
      testID="viewer-rail"
      style={[
        styles.rail,
        {
          paddingTop: topInset + Space.sm,
          paddingBottom: bottomInset + Space.sm,
        },
      ]}
    >
      <Pressable
        testID="viewer-rail-back"
        accessibilityRole="button"
        accessibilityLabel={BACK_LABEL}
        accessibilityHint={BACK_HINT}
        accessibilityState={{ disabled: false }}
        onPress={onBack}
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      >
        <Icon name={IconName.back} color={Color.secondaryText} />
      </Pressable>
      <View style={styles.capabilities}>
        {CAPABILITIES.map(item => {
          const selected = drawerOpen && capability === item.value;
          return (
            <Pressable
              key={item.value}
              testID={`viewer-rail-${item.value}`}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityHint={selected ? CLOSE_HINT : OPEN_HINT}
              accessibilityState={{ selected }}
              onPress={() => onCapability(item.value)}
              style={({ pressed }) => [
                styles.control,
                selected && styles.selected,
                pressed && styles.pressed,
              ]}
            >
              <Icon
                name={item.icon}
                color={selected ? Color.accent : Color.muted}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: RAIL_WIDTH,
    flexShrink: 0,
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: Color.rail,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Color.line,
  },
  control: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capabilities: { gap: Space.sm, paddingTop: Space.xl },
  selected: { backgroundColor: Color.accentWash },
  pressed: { backgroundColor: Color.pressed },
});
