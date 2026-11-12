import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, IconName } from '../../../ui/Icon';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';

export type AppSection = 'Organizations' | 'Progress' | 'Downloads' | 'Help';
const ITEMS = [
  {
    title: 'Organizations',
    label: 'Organizations',
    icon: IconName.organization,
  },
  { title: 'Progress', label: 'My progress', icon: IconName.progress },
] as const;

export function CourseNavigation({
  section,
  compact,
  onSelect,
  continuation,
  onContinue,
}: {
  section: AppSection;
  compact: boolean;
  onSelect: (section: AppSection) => void;
  continuation?: { title: string; step: string };
  onContinue?: () => void;
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
      <View style={styles.brand} accessibilityLabel="Miris">
        <Icon name={IconName.organization} size={24} color={C.text} />
        {!compact && <Text style={styles.brandText}>Miris</Text>}
      </View>
      {!compact && <Text style={styles.sectionLabel}>Workspace</Text>}
      {ITEMS.map(item => (
        <Pressable
          key={item.title}
          testID={`navigation-${item.title.toLowerCase()}`}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: section === item.title }}
          onPress={() => onSelect(item.title)}
          style={({ pressed }) => [
            styles.item,
            section === item.title && styles.selected,
            pressed && styles.pressed,
          ]}
        >
          <Icon
            name={item.icon}
            size={18}
            color={section === item.title ? C.accent : C.secondary}
          />
          {!compact && (
            <Text
              style={[
                styles.label,
                section === item.title && styles.activeLabel,
              ]}
            >
              {item.label}
            </Text>
          )}
        </Pressable>
      ))}
      {continuation && onContinue && (
        <Pressable
          testID="navigation-resume"
          accessibilityRole="button"
          accessibilityLabel={`Resume ${continuation.title}, ${continuation.step}`}
          onPress={onContinue}
          style={({ pressed }) => [styles.resume, pressed && styles.pressed]}
        >
          <Icon name={IconName.play} color={C.accent} size={18} />
          {!compact && (
            <View style={styles.resumeBody}>
              <Text style={styles.activeLabel}>Continue learning</Text>
              <Text numberOfLines={2} style={styles.label}>
                {continuation.title}
              </Text>
              <Text style={styles.sectionLabel}>{continuation.step}</Text>
            </View>
          )}
        </Pressable>
      )}
      <View style={styles.spacer} />
      {(['Downloads', 'Help'] as const).map(title => (
        <Pressable
          key={title}
          testID={`navigation-${title.toLowerCase()}`}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ selected: section === title }}
          onPress={() => onSelect(title)}
          style={({ pressed }) => [
            styles.item,
            section === title && styles.selected,
            pressed && styles.pressed,
          ]}
        >
          <Icon
            name={title === 'Downloads' ? IconName.download : IconName.help}
            size={18}
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
  sectionLabel: { ...T.caption, color: C.secondary, paddingHorizontal: G.unit },
  item: {
    minHeight: G.control,
    borderRadius: R.control,
    paddingHorizontal: G.unit,
    flexDirection: 'row',
    gap: G.unit,
    alignItems: 'center',
  },
  selected: { backgroundColor: C.raised },
  pressed: { backgroundColor: C.surface },
  label: { ...T.label, color: C.secondary, flexShrink: 1 },
  activeLabel: { ...T.label, color: C.text },
  resume: {
    flexDirection: 'row',
    gap: G.unit,
    padding: G.unit,
    marginTop: G.small,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.control,
  },
  resumeBody: { flex: 1, gap: G.unit },
  spacer: { flex: 1, minHeight: G.large },
});
