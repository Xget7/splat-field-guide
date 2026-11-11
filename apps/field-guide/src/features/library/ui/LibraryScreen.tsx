import { OfflinePreparation } from '../../instructor/views';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Guide, type ReadyGuide } from '../../pack/catalog';
import {
  LearnMode,
  type Progress,
  type ProgressStorage,
  type SessionStart,
} from '../../guide';

import { CourseSurface } from '../../../ui/CourseSurface';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';
import { continueRowFor } from '../domain/library';
import { ContinueCard } from './GuideCards';
import { CourseNavigation, type CourseSection } from './CourseNavigation';
import { CourseOverview, DEMO_MODULES, ModuleCard } from './CourseOverview';
import { CourseComposer } from './CourseComposer';
import { CourseDownloads } from './CourseDownloads';

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
  const [progress, setProgress] = useState<Progress | null>(null);

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

  const [section, setSection] = useState<CourseSection>('Course');
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const ask = (question: string) => {
    setLastQuestion(question);
    setDraft('');
    setNotice(null);
    setSection('Assistant');
  };
  const explore = () => {
    const guide = catalog[0];
    const tour = guide?.pack.procedures[0];
    if (!guide || !tour) {
      unavailable();
      return;
    }
    onOpen({
      guideId: guide.id,
      procedureId: tour.id,
      stepIndex: 0,
      mode: LearnMode.selfGuided,
    });
  };
  const { width, fontScale } = useWindowDimensions();
  const columns = width >= 1056 && fontScale < 1.4;
  const compact = width < 800;
  const unavailable = () =>
    setNotice('The 3D scene is not available on this device yet.');
  const document = () => {
    setSection('Documentation');
    setNotice(null);
  };
  const select = (next: CourseSection) => {
    setSection(next);
    setNotice(null);
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[
        styles.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <CourseNavigation section={section} compact={compact} onSelect={select} />
      <View style={styles.page}>
        <CourseSurface />
        <ScrollView
          testID="library-screen"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Text style={styles.breadcrumb}>
            Organization / Courses /{' '}
            <Text style={styles.current}>Automotive Assembly Line</Text>
          </Text>
          <View accessibilityRole="tablist" style={styles.tabs}>
            {(['Course', 'Modules', 'Documentation'] as const).map(tab => (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: section === tab }}
                onPress={() => select(tab)}
                style={[styles.tab, section === tab && styles.activeTab]}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    section === tab && styles.activeTabLabel,
                  ]}
                >
                  {tab}
                  {tab === 'Modules' ? '  03' : ''}
                </Text>
              </Pressable>
            ))}
          </View>
          {section === 'Course' && (
            <CourseOverview
              wide={columns}
              onExplore={explore}
              onAsk={ask}
              question={draft}
              onQuestionChange={setDraft}
              onDocument={document}
              onDownloads={() => select('Downloads')}
            />
          )}
          {(section === 'Course' || section === 'Modules') && (
            <View style={styles.modules}>
              {continuation && (
                <ContinueCard row={continuation} onPress={continueGuide} />
              )}
              <View style={styles.moduleHeader}>
                <Text accessibilityRole="header" style={styles.heading}>
                  Course modules
                </Text>
                <Text style={styles.secondary}>3 modules</Text>
              </View>
              <View style={[styles.cards, !columns && styles.stacked]}>
                {DEMO_MODULES.map((title, index) => (
                  <ModuleCard
                    key={title}
                    title={title}
                    index={index}
                    testID={
                      index === 0 && catalog[0]
                        ? `guide-card-${catalog[0].id}`
                        : undefined
                    }
                    onPress={() =>
                      index === 0 && catalog[0]
                        ? onOpenGuide(catalog[0])
                        : setNotice('This module is not available yet.')
                    }
                  />
                ))}
              </View>
            </View>
          )}
          {section === 'Assistant' && (
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.heading}>
                Assistant
              </Text>
              {lastQuestion && (
                <Text style={styles.question}>{lastQuestion}</Text>
              )}
              <Text style={styles.secondary}>
                Course answers are not connected yet.
              </Text>
              <CourseComposer
                onAsk={ask}
                onDocument={document}
                question={draft}
                onQuestionChange={setDraft}
              />
            </View>
          )}
          {section === 'Documentation' && (
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.heading}>
                KR QUANTEC extra.pdf
              </Text>
              <Text style={styles.secondary}>
                The manual is not available on this device yet.
              </Text>
            </View>
          )}
          {section === 'Downloads' && (
            <CourseDownloads
              sceneAvailable={catalog.length > 0}
              onBack={() => select('Course')}
            />
          )}
          {section === 'Help' && (
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.heading}>
                Help
              </Text>
              <Text style={styles.secondary}>
                Open an available module to explore its equipment.
              </Text>
            </View>
          )}
          {section !== 'Downloads' && <OfflinePreparation showReady />}
          {notice && section !== 'Assistant' && (
            <Text accessibilityRole="alert" style={styles.secondary}>
              {notice}
            </Text>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, flexDirection: 'row', backgroundColor: C.canvas },
  page: {
    flex: 1,
    margin: G.unit,
    marginLeft: 0,
    borderRadius: R.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  content: { padding: G.large, gap: G.large },
  breadcrumb: { ...T.caption, color: C.secondary },
  current: { ...T.label, color: C.text },
  secondary: { ...T.body, color: C.secondary },
  tabs: {
    flexDirection: 'row',
    gap: G.medium,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexWrap: 'wrap',
  },
  tab: {
    minHeight: G.control,
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: { borderBottomColor: C.text },
  tabLabel: { ...T.label, color: C.secondary },
  activeTabLabel: { color: C.text },
  modules: { gap: G.medium },
  moduleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: G.unit,
    alignItems: 'center',
  },
  heading: { ...T.heading, color: C.text },
  cards: { flexDirection: 'row', gap: G.small },
  stacked: { flexDirection: 'column' },
  panel: { gap: G.medium, maxWidth: 720 },
  question: {
    ...T.body,
    color: C.text,
    backgroundColor: C.raised,
    borderRadius: R.control,
    padding: G.small,
  },
});
