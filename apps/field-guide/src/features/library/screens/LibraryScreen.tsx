import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CATEGORY_TITLE,
  GuideStatus,
  type ComingSoonGuide,
  type ReadyGuide,
} from '../../../modules/catalog/catalog';
import { useCatalog } from '../../../modules/catalog/CatalogContext';
import {
  LearnMode,
  Route,
  type ScreenProps,
} from '../../../shared/navigation/routes';
import { type Progress } from '../../../modules/progress/model/progress';
import { loadProgress } from '../../../modules/progress/data/progressStorage';
import { Icon, IconName } from '../../../shared/ui/kit/Icon';
import { Label } from '../../../shared/ui/kit/Label';
import { twoDigits } from '../../../shared/ui/readout';
import {
  Color,
  MIN_TOUCH,
  Radius,
  Space,
  Type,
} from '../../../shared/ui/theme';
import {
  continueRowFor,
  filterGuides,
  LIBRARY_CATEGORIES,
  LibraryCategory,
} from '../model/library';
import { ContinueCard, ReadyCard, SoonCard } from '../components/GuideCards';

const Layout = {
  searchHeight: 40,
  chipHeight: 32,
  columns: 2,
} as const;

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.row}>
      <Label>{title}</Label>
      {count !== undefined && (
        <Label color={Color.faint}>{twoDigits(count)}</Label>
      )}
    </View>
  );
}

export function LibraryScreen({
  navigation,
}: ScreenProps<typeof Route.library>) {
  const catalog = useCatalog();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<LibraryCategory>(
    LibraryCategory.all,
  );
  const [progress, setProgress] = useState<Progress | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // A blurred screen must not apply a stale storage read on the next visit.
      loadProgress().then(
        saved => {
          if (active) {
            setProgress(saved);
          }
        },
        () => {
          if (active) {
            setProgress(null);
          }
        },
      );
      return () => {
        active = false;
      };
    }, []),
  );

  const filtered = filterGuides(catalog, query, category);
  const ready = filtered.filter(
    (guide): guide is ReadyGuide => guide.status === GuideStatus.ready,
  );
  const soon = filtered.filter(
    (guide): guide is ComingSoonGuide =>
      guide.status === GuideStatus.comingSoon,
  );
  const continuation = continueRowFor(catalog, progress);
  const continueGuide = () => {
    if (continuation) {
      navigation.navigate(Route.viewer, {
        guideId: continuation.guide.id,
        procedureId: continuation.procedure.id,
        stepIndex: continuation.stepIndex,
        mode: LearnMode.selfGuided,
      });
    }
  };

  return (
    <ScrollView
      testID="library-screen"
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Space.lg,
          paddingBottom: insets.bottom + Space.xxl,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
    >
      <Text style={styles.title}>Guides</Text>
      <View style={styles.search}>
        <Icon name={IconName.search} color={Color.muted} />
        <TextInput
          testID="library-search"
          accessibilityLabel="Search guides"
          placeholder="Search guides"
          placeholderTextColor={Color.faint}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={styles.input}
        />
        {query.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setQuery('')}
            style={styles.clear}
          >
            <Icon name={IconName.close} color={Color.muted} />
          </Pressable>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
        contentContainerStyle={styles.chips}
      >
        {LIBRARY_CATEGORIES.map(value => {
          const selected = category === value;
          const title =
            value === LibraryCategory.all ? 'All' : CATEGORY_TITLE[value];
          return (
            <Pressable
              key={value}
              testID={`library-chip-${value}`}
              accessibilityRole="button"
              accessibilityLabel={title}
              accessibilityState={{ selected }}
              onPress={() => setCategory(value)}
              style={[styles.chip, selected && styles.selectedChip]}
            >
              <Label color={selected ? Color.black : Color.secondaryText}>
                {title}
              </Label>
            </Pressable>
          );
        })}
      </ScrollView>
      {filtered.length === 0 && (
        <Text style={styles.empty}>No guides match.</Text>
      )}
      {continuation && (
        <View style={styles.section}>
          <SectionHeader title="Continue" />
          <ContinueCard row={continuation} onPress={continueGuide} />
        </View>
      )}
      {ready.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Ready" count={ready.length} />
          {ready.map(guide => (
            <ReadyCard
              key={guide.id}
              guide={guide}
              onPress={() =>
                navigation.navigate(Route.guide, { guideId: guide.id })
              }
            />
          ))}
        </View>
      )}
      {soon.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Coming soon" count={soon.length} />
          {soon
            .filter((_, index) => index % Layout.columns === 0)
            .map((guide, row) => (
              <View key={guide.id} style={styles.gridRow}>
                <SoonCard guide={guide} />
                {soon[row * Layout.columns + 1] ? (
                  <SoonCard guide={soon[row * Layout.columns + 1]} />
                ) : (
                  <View style={styles.gridSpacer} />
                )}
              </View>
            ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Color.black },
  content: { paddingHorizontal: Space.lg, gap: Space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { ...Type.largeTitle, color: Color.text },
  search: {
    minHeight: Layout.searchHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    backgroundColor: Color.raised,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.line,
  },
  input: {
    ...Type.callout,
    color: Color.text,
    flex: 1,
    padding: 0,
    minHeight: Layout.searchHeight,
  },
  clear: {
    minHeight: Layout.searchHeight,
    minWidth: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Runs to the screen edges so a chip cut off there reads as more to scroll to.
  rail: { flexGrow: 0, marginHorizontal: -Space.lg },
  chips: { gap: Space.sm, paddingHorizontal: Space.lg },
  chip: {
    minHeight: Layout.chipHeight,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.line,
    backgroundColor: Color.raised,
  },
  selectedChip: { backgroundColor: Color.text, borderColor: Color.text },
  section: { gap: Space.md, marginTop: Space.sm },
  empty: { ...Type.callout, color: Color.muted },
  gridRow: { flexDirection: 'row', gap: Space.md, alignItems: 'stretch' },
  gridSpacer: { flex: 1 },
});
