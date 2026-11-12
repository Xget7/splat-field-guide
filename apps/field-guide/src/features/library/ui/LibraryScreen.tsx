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
import { continueRowFor, factsFor } from '../domain/library';
import { TOUR_ID } from '../../pack/tour';
import { ContinueCard } from './GuideCards';
import { CourseNavigation, type AppSection } from './CourseNavigation';
import { CourseOverview, ModuleCard } from './CourseOverview';
import { CourseAssistant } from './CourseAssistant';
import { CourseDocumentation } from './CourseDocumentation';
import type { CourseDocuments } from '../../../platform/documents';
import { CourseDownloads } from './CourseDownloads';

type CourseSection = 'Course' | 'Modules' | 'Assistant' | 'Documentation';

export interface LibraryScreenProps {
  readonly catalog: readonly Guide[];
  readonly documents?: CourseDocuments;
  /** Read again on every focus, so a session that just closed shows as the continuation. */
  readonly progress: Pick<ProgressStorage, 'load'>;
  readonly onOpenGuide: (guide: ReadyGuide) => void;
  /** Opens the viewer where the saved progress left off. */
  readonly onOpen: (start: SessionStart) => void;
}

export function LibraryScreen({
  catalog,
  documents,
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
  const moduleCount = catalog.reduce(
    (count, guide) => count + guide.pack.procedures.length,
    0,
  );
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

  const [destination, setDestination] = useState<AppSection>('Courses');
  const inCourse = destination === 'Courses';
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
    documents
      ?.open('kuka-quantec-extra-v4')
      .catch(() =>
        setNotice('Could not open the on-device manual. Try again.'),
      );
  };
  const selectDestination = (next: AppSection) => {
    if (next === 'Equipment') {
      explore();
      return;
    }
    if (next === 'Modules' || next === 'Documentation') {
      setDestination('Courses');
      setSection(next);
    } else {
      setDestination(next);
      if (next === 'Courses') setSection('Course');
    }
    setNotice(null);
  };
  const navigationSection =
    inCourse && (section === 'Modules' || section === 'Documentation')
      ? section
      : destination;
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
      <CourseNavigation
        section={navigationSection}
        compact={compact}
        continuation={
          continuation
            ? {
                title: continuation.procedure.title,
                step: continuation.stepLabel,
              }
            : undefined
        }
        onContinue={continueGuide}
        onSelect={selectDestination}
      />
      <View style={styles.page}>
        <CourseSurface />
        <ScrollView
          testID="library-screen"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {inCourse && (
            <>
              <Text testID="course-breadcrumb" style={styles.breadcrumb}>
                Organization / Courses /{' '}
                <Text style={styles.current}>Automotive Assembly Line</Text>
              </Text>
              <View accessibilityRole="tablist" style={styles.tabs}>
                {(
                  ['Course', 'Modules', 'Documentation', 'Assistant'] as const
                ).map(tab => (
                  <Pressable
                    key={tab}
                    accessibilityRole="tab"
                    accessibilityLabel={tab}
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
                      {tab === 'Modules'
                        ? `  ${String(moduleCount).padStart(2, '0')}`
                        : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {inCourse && section === 'Course' && (
            <CourseOverview
              wide={columns}
              onExplore={explore}
              onAsk={ask}
              question={draft}
              onQuestionChange={setDraft}
              onDocument={document}
              onDownloads={() => selectDestination('Downloads')}
            />
          )}
          {inCourse && (section === 'Course' || section === 'Modules') && (
            <View style={styles.modules}>
              {continuation && (
                <ContinueCard row={continuation} onPress={continueGuide} />
              )}
              <View style={styles.moduleHeader}>
                <Text accessibilityRole="header" style={styles.heading}>
                  Course modules
                </Text>
                <Text style={styles.secondary}>
                  {moduleCount} {moduleCount === 1 ? 'module' : 'modules'}
                </Text>
              </View>
              <View style={[styles.cards, !columns && styles.stacked]}>
                {catalog.map(guide => (
                  <ModuleCard
                    key={guide.id}
                    title={guide.title}
                    details={factsFor(guide).join(', ')}
                    action="Choose guidance"
                    index={0}
                    wide={columns}
                    testID={`guide-card-${guide.id}`}
                    onPress={() => onOpenGuide(guide)}
                  />
                ))}
                {catalog.flatMap(guide =>
                  guide.pack.procedures
                    .filter(procedure => procedure.id !== TOUR_ID)
                    .map((procedure, index) => (
                      <ModuleCard
                        key={`${guide.id}:${procedure.id}`}
                        title={procedure.title}
                        details={`${procedure.steps.length} ${
                          procedure.steps.length === 1 ? 'step' : 'steps'
                        }${
                          procedure.steps.some(step => step.caution.trim())
                            ? ', includes safety notes'
                            : ''
                        }`}
                        action="Start procedure"
                        index={index + 1}
                        wide={columns}
                        testID={`module-procedure-${guide.id}-${procedure.id}`}
                        onPress={() =>
                          onOpen({
                            guideId: guide.id,
                            procedureId: procedure.id,
                            stepIndex: 0,
                            mode: LearnMode.selfGuided,
                          })
                        }
                      />
                    )),
                )}
              </View>
            </View>
          )}
          <View
            style={!(inCourse && section === 'Assistant') && styles.hidden}
            accessibilityElementsHidden={!(inCourse && section === 'Assistant')}
            importantForAccessibility={
              inCourse && section === 'Assistant'
                ? 'auto'
                : 'no-hide-descendants'
            }
          >
            <CourseAssistant
              guide={catalog[0] ?? null}
              question={lastQuestion}
              draft={draft}
              onDraftChange={setDraft}
              active={inCourse && section === 'Assistant'}
              onOpen={onOpen}
              onDocument={document}
            />
          </View>
          {inCourse && section === 'Documentation' && (
            <CourseDocumentation documents={documents} />
          )}
          {destination === 'Downloads' && (
            <CourseDownloads
              sceneAvailable={catalog.length > 0}
              onBack={() => {
                select('Course');
                selectDestination('Courses');
              }}
            />
          )}
          {destination === 'Help' && (
            <View style={styles.panel}>
              <Text accessibilityRole="header" style={styles.heading}>
                Help
              </Text>
              <Text style={styles.secondary}>
                Drag the 3D scene to orbit, pinch to zoom and tap a component to
                select it.
              </Text>
              <Text style={styles.secondary}>
                Self-guided keeps you in control of each step. Instructor adds
                contextual questions and optional voice.
              </Text>
              <Pressable
                testID="help-equipment"
                accessibilityRole="button"
                accessibilityLabel="Explore equipment"
                onPress={explore}
                style={styles.helpAction}
              >
                <Text style={styles.helpActionText}>Explore equipment</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Browse course modules"
                onPress={() => selectDestination('Modules')}
                style={styles.helpAction}
              >
                <Text style={styles.helpActionText}>Browse course modules</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Read equipment documentation"
                onPress={() => selectDestination('Documentation')}
                style={styles.helpAction}
              >
                <Text style={styles.helpActionText}>
                  Read equipment documentation
                </Text>
              </Pressable>
            </View>
          )}
          {inCourse && <OfflinePreparation showReady />}
          {inCourse && notice && section !== 'Assistant' && (
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
  hidden: { display: 'none' },
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
  helpAction: {
    minHeight: G.control,
    padding: G.small,
    backgroundColor: C.raised,
    borderRadius: R.control,
    justifyContent: 'center',
  },
  helpActionText: { ...T.label, color: C.text },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: G.small },
  stacked: { flexDirection: 'column' },
  panel: { gap: G.medium, maxWidth: 720 },
});
