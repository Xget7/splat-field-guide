import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, IconName } from '../../../ui/Icon';
import { Color, MIN_TOUCH, Radius, Space, Type } from '../../../ui/theme';
import { DRAWER_WIDTH } from './layout';

const CLOSE_LABEL = 'Close panel';
const CLOSE_HINT = 'Keep the viewer open with more room for the picture';

interface Props {
  title: string;
  icon: IconName;
  topInset: number;
  bottomInset: number;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Drawer({
  title,
  icon,
  topInset,
  bottomInset,
  onClose,
  children,
  footer,
}: Props) {
  return (
    <View
      testID="viewer-drawer"
      style={[
        styles.drawer,
        {
          paddingTop: topInset + Space.sm,
          paddingBottom: bottomInset,
        },
      ]}
    >
      <View style={styles.header}>
        <Icon name={icon} color={Color.accent} />
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Pressable
          testID="drawer-close"
          accessibilityRole="button"
          accessibilityLabel={CLOSE_LABEL}
          accessibilityHint={CLOSE_HINT}
          accessibilityState={{ disabled: false }}
          onPress={onClose}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Icon name={IconName.close} color={Color.muted} />
        </Pressable>
      </View>
      <ScrollView
        testID="drawer-body"
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footer != null && <View style={styles.footer}>{footer}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    width: DRAWER_WIDTH,
    flexShrink: 0,
    alignSelf: 'stretch',
    backgroundColor: Color.drawer,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Color.line,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingLeft: Space.xl,
    paddingRight: Space.md,
    paddingBottom: Space.lg,
  },
  title: { ...Type.headline, flex: 1, color: Color.text },
  close: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: Color.pressed },
  scroll: { flex: 1 },
  body: { flexGrow: 1 },
  footer: {
    padding: Space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Color.line,
  },
});
