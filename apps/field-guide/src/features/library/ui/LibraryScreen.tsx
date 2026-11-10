import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Guide, type ReadyGuide } from '../../pack/catalog';
import {
  LearnMode,
  type Progress,
  type ProgressStorage,
  type SessionStart,
} from '../../guide';

import { SectionHeader } from '../../../ui/SectionHeader';
import { Backdrop } from '../../../ui/Gradients';
import { ScrollEdge, useScrollOffset } from '../../../ui/ScrollEdge';
import { Color, Space, Type } from '../../../ui/theme';
import { continueRowFor } from '../domain/library';

import { ContinueCard, ReadyCard } from './GuideCards';
import { useWideLayout } from '../../../ui/useWideLayout';

const Layout = {
  introWidth: 560,
} as const;

export interface LibraryScreenProps {
  readonly catalog: readonly Guide[];
  /** Read again on every focus, so a session that just closed shows as the continuation. */
  readonly progress: Pick<ProgressStorage, 'load'>;
  readonly onOpenGuide: (guide: ReadyGuide) => void;
  /** Opens the viewer where the saved progress left off. */
  readonly onOpen: (start: SessionStart) => void;
}

export function LibraryScreen({
  catalog,
  progress: storage,
  onOpenGuide,
  onOpen,
}: LibraryScreenProps) {
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
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
        {catalog.length === 0 && (
          <View testID="library-empty" style={styles.section}>
            <Text accessibilityRole="header" style={styles.lede}>
              No guide available
            </Text>
            <Text style={styles.lede}>
              A validated Miris pack has not been installed yet.
            </Text>
          </View>
        )}
        {continuation && (
          <View style={styles.section}>
            <SectionHeader title="Continue" />
            <ContinueCard row={continuation} onPress={continueGuide} />
          </View>
        )}
        {catalog.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Ready" />
            {catalog.map(guide => (
              <ReadyCard
                key={guide.id}
                guide={guide}
                wide={wide}
                onPress={() => onOpenGuide(guide)}
              />
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
});
