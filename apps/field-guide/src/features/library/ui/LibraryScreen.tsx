import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GuideStatus,
  type ComingSoonGuide,
  type Guide,
  type ReadyGuide,
} from '../../pack/catalog';
import {
  LearnMode,
  type Progress,
  type ProgressStorage,
  type SessionStart,
} from '../../guide';
import { AssemblyBanner } from '../../ar/views';

import { SectionHeader } from '../../../ui/SectionHeader';
import { Backdrop } from '../../../ui/Gradients';
import { ScrollEdge, useScrollOffset } from '../../../ui/ScrollEdge';
import { Color, Space, Type } from '../../../ui/theme';
import { continueRowFor } from '../domain/library';

import { ContinueCard, ReadyCard, SoonCard } from './GuideCards';
import { useWideLayout } from '../../../ui/useWideLayout';

const Layout = {
  columns: 2,
  wideColumns: 4,
  introWidth: 560,
} as const;

function rowsOf<T>(items: readonly T[], columns: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / columns) }, (_, row) =>
    items.slice(row * columns, (row + 1) * columns),
  );
}

export interface LibraryScreenProps {
  readonly catalog: readonly Guide[];
  /** Read again on every focus, so a session that just closed shows as the continuation. */
  readonly progress: Pick<ProgressStorage, 'load'>;
  readonly onOpenGuide: (guide: ReadyGuide) => void;
  /** Opens the viewer where the saved progress left off. */
  readonly onOpen: (start: SessionStart) => void;
  /** Present only where the device offers the assembly tour. */
  readonly onOpenAssembly?: () => void;
}

export function LibraryScreen({
  catalog,
  progress: storage,
  onOpenGuide,
  onOpen,
  onOpenAssembly,
}: LibraryScreenProps) {
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const columns = wide ? Layout.wideColumns : Layout.columns;
  const [progress, setProgress] = useState<Progress | null>(null);
  const scroll = useScrollOffset();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // A blurred screen must not apply a stale storage read on the next visit.
      storage.load().then(
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
    }, [storage]),
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
    // Continuing reopens the step on its own, without the instructor.
    if (continuation) {
      onOpen({
        guideId: continuation.guide.id,
        procedureId: continuation.procedure.id,
        stepIndex: continuation.stepIndex,
        mode: LearnMode.selfGuided,
      });
    }
  };

  return (
    <View style={styles.screen}>
      <Backdrop />
      <Animated.ScrollView
        testID="library-screen"
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          wide && styles.contentWide,
          {
            paddingTop: insets.top + (wide ? Space.xxl : Space.lg),
            paddingBottom: insets.bottom + Space.xxl,
          },
        ]}
        contentInsetAdjustmentBehavior="never"
        onScroll={scroll.onScroll}
      >
        <View style={styles.intro}>
          <Text
            accessibilityRole="header"
            style={wide ? styles.titleWide : styles.title}
          >
            Guides
          </Text>
          <Text style={styles.lede}>
            Maintenance guides built from 3D captures of real equipment.
          </Text>
        </View>
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
                onPress={() => onOpenGuide(guide)}
              />
            ))}
          </View>
        )}
        {onOpenAssembly && (
          <View style={styles.section}>
            <SectionHeader title="Spatial assembly" />
            <AssemblyBanner wide={wide} onPress={onOpenAssembly} />
          </View>
        )}
        {soon.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Coming soon" />
            {rowsOf(soon, columns).map(row => (
              <View key={row[0].id} style={styles.gridRow}>
                {row.map(guide => (
                  <SoonCard key={guide.id} guide={guide} wide={wide} />
                ))}
                {Array.from({ length: columns - row.length }, (_, index) => (
                  <View key={index} style={styles.gridSpacer} />
                ))}
              </View>
            ))}
          </View>
        )}
      </Animated.ScrollView>
      <ScrollEdge offset={scroll.offset} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Color.surface },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Space.lg, gap: Space.xl },
  contentWide: { paddingHorizontal: Space.xxl },
  intro: { gap: Space.sm, marginBottom: Space.sm },
  title: { ...Type.display, color: Color.text },
  titleWide: { ...Type.displayWide, color: Color.text },
  lede: {
    ...Type.body,
    color: Color.secondaryText,
    maxWidth: Layout.introWidth,
  },
  section: { gap: Space.md, marginTop: Space.sm },
  gridRow: { flexDirection: 'row', gap: Space.md, alignItems: 'stretch' },
  gridSpacer: { flex: 1 },
});
