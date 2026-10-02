import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
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
import { SectionHeader } from '../../../shared/ui/kit/SectionHeader';
import { Color, Space, Type } from '../../../shared/ui/theme';
import { continueRowFor } from '../model/library';
import { ContinueCard, ReadyCard, SoonCard } from '../components/GuideCards';
import { useWideLayout } from '../../../shared/hooks/useWideLayout';

const Layout = {
  columns: 2,
  wideColumns: 4,
} as const;

/** `items` in rows of `columns`. */
function rowsOf<T>(items: readonly T[], columns: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / columns) }, (_, row) =>
    items.slice(row * columns, (row + 1) * columns),
  );
}

export function LibraryScreen({
  navigation,
}: ScreenProps<typeof Route.library>) {
  const catalog = useCatalog();
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const columns = wide ? Layout.wideColumns : Layout.columns;
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

  const ready = catalog.filter(
    (guide): guide is ReadyGuide => guide.status === GuideStatus.ready,
  );
  const soon = catalog.filter(
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
    <View style={styles.screen}>
      <ScrollView
        testID="library-screen"
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Space.lg,
            paddingBottom: insets.bottom + Space.xxl,
          },
        ]}
        contentInsetAdjustmentBehavior="never"
      >
        <Text accessibilityRole="header" style={styles.title}>
          Guides
        </Text>
        {continuation && (
          <View style={styles.section}>
            <SectionHeader title="Continue" />
            <ContinueCard row={continuation} onPress={continueGuide} />
          </View>
        )}
        {ready.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Ready" />
            {ready.map(guide => (
              <ReadyCard
                key={guide.id}
                guide={guide}
                wide={wide}
                onPress={() =>
                  navigation.navigate(Route.guide, { guideId: guide.id })
                }
              />
            ))}
          </View>
        )}
        {soon.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Coming soon" />
            {rowsOf(soon, columns).map(row => (
              <View key={row[0].id} style={styles.gridRow}>
                {row.map(guide => (
                  <SoonCard key={guide.id} guide={guide} />
                ))}
                {Array.from({ length: columns - row.length }, (_, index) => (
                  <View key={index} style={styles.gridSpacer} />
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Color.black },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Space.lg, gap: Space.lg },
  title: { ...Type.largeTitle, color: Color.text },
  section: { gap: Space.md, marginTop: Space.sm },
  gridRow: { flexDirection: 'row', gap: Space.md, alignItems: 'stretch' },
  gridSpacer: { flex: 1 },
});
