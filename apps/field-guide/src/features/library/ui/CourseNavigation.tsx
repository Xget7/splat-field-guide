import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon, IconName } from '../../../ui/Icon';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';
export type CourseSection =
  | 'Course'
  | 'Modules'
  | 'Assistant'
  | 'Documentation'
  | 'Downloads'
  | 'Help';
const ITEMS = [
  { title: 'Course', icon: IconName.layers },
  { title: 'Assistant', icon: IconName.chat },
  { title: 'Documentation', icon: IconName.list },
] as const;
export function CourseNavigation({
  section,
  compact,
  onSelect,
}: {
  section: CourseSection;
  compact: boolean;
  onSelect: (section: CourseSection) => void;
}) {
  return (
    <ScrollView
      style={[styles.sidebar, compact && styles.compact]}
      contentContainerStyle={[
        styles.contents,
        compact && styles.compactContents,
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.brand}>
        <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}>
          <Path d="M12 1L23 7 12 13 1 7Z" fill={C.white} />
          <Path d="M1 7L12 13V24L1 18Z" fill={C.secondary} />
          <Path d="M12 13L23 7V18L12 24Z" fill={C.text} />
        </Svg>
        {!compact && <Text style={styles.brandText}>Sche</Text>}
      </View>
      {ITEMS.map(item => (
        <Pressable
          key={item.title}
          accessibilityRole="button"
          accessibilityLabel={item.title}
          accessibilityState={{ selected: section === item.title }}
          onPress={() => onSelect(item.title)}
          style={[styles.item, section === item.title && styles.selected]}
        >
          <Icon
            name={item.icon}
            size={16}
            color={section === item.title ? C.accent : C.secondary}
          />
          {!compact && <Text style={styles.label}>{item.title}</Text>}
        </Pressable>
      ))}
      <View style={styles.spacer} />
      {(['Downloads', 'Help'] as const).map(title => (
        <Pressable
          key={title}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ selected: section === title }}
          onPress={() => onSelect(title)}
          style={[styles.item, section === title && styles.selected]}
        >
          <Icon
            name={title === 'Downloads' ? IconName.down : IconName.help}
            size={16}
            color={section === title ? C.accent : C.secondary}
          />
          {!compact && <Text style={styles.label}>{title}</Text>}
        </Pressable>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  sidebar: { width: G.sidebar, flexGrow: 0, flexShrink: 0 },
  compact: { width: 64 },
  contents: { flexGrow: 1, padding: G.small, gap: G.unit },
  compactContents: { padding: G.unit },
  brand: {
    flexDirection: 'row',
    gap: G.unit,
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: G.unit,
  },
  brandText: { ...T.heading, color: C.text },
  item: {
    minHeight: G.control,
    borderRadius: R.control,
    paddingHorizontal: G.unit,
    flexDirection: 'row',
    gap: G.unit,
    alignItems: 'center',
  },
  selected: { backgroundColor: C.raised },
  label: { ...T.label, color: C.secondary, flexShrink: 1 },
  spacer: { flex: 1 },
});
