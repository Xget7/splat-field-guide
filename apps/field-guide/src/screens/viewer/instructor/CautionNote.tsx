import { StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { Icon, IconName } from '../../../ui/Icon';
import { Color, Radius, Space, Type } from '../../../ui/theme';
import { MODE_RULE_WIDTH } from './ModeBanner';

const ICON_SIZE = 16;

export function CautionNote({
  text,
  children,
}: {
  text: string;
  children?: ReactNode;
}) {
  return (
    <View
      testID="caution"
      accessible
      accessibilityLabel={`Caution: ${text}`}
      style={styles.note}
    >
      <Icon name={IconName.warn} size={ICON_SIZE} color={Color.caution} />
      <Text style={styles.text}>{children ?? text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radius.sm,
    borderLeftWidth: MODE_RULE_WIDTH,
    borderLeftColor: Color.caution,
    backgroundColor: Color.cautionWash,
  },
  text: { ...Type.footnote, flex: 1, color: Color.caution },
});
