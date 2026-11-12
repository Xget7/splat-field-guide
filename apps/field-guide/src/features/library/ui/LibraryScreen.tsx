import { OfflinePreparation } from '../../instructor/views';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
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
import { TOUR_ID } from '../../pack/tour';
import { ContinueCard } from './GuideCards';
import { CourseNavigation, type AppSection } from './CourseNavigation';
import { CourseOverview, ModuleCard } from './CourseOverview';
import {
  CourseAssistant,
  type CourseAssistantControls,
} from './CourseAssistant';
import { CourseDocumentation } from './CourseDocumentation';
import type { CourseDocuments } from '../../../platform/documents';
import { CourseDownloads } from './CourseDownloads';
import {
  WorkspaceHome,
  DEFAULT_ORGANIZATION,
  COURSE_TITLE,
  WorkspaceProgress,
} from './WorkspaceHome';

type Destination = AppSection | 'Courses';

type CourseSection = 'Course' | 'Documentation';

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

  const [destination, setDestination] = useState<Destination>('Organizations');
  const [courseOpen, setCourseOpen] = useState(false);
  const inCourse = destination === 'Courses' && courseOpen;
  const [section, setSection] = useState<CourseSection>('Course');
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const assistant = useRef<CourseAssistantControls>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const ask = (question: string) => {
    setLastQuestion(previous => ({
      id: (previous?.id ?? 0) + 1,
      text: question,
    }));
    setDraft('');
    setNotice(null);
    setSection('Course');
  };
  const explore = () => {
    const guide = catalog[0];
    if (!guide) {
      unavailable();
      return;
    }
    onOpen({
      guideId: guide.id,
      procedureId: null,
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
  const selectDestination = (next: Destination) => {
    setDestination(next);
    setCourseOpen(false);
    setNotice(null);
  };
  const openCourse = (next: CourseSection = section) => {
    setDestination('Courses');
    setCourseOpen(true);
    setSection(next);
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
      <CourseNavigation
        section={destination === 'Courses' ? 'Organizations' : destination}
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
          {destination === 'Courses' && (
            <View
              testID={inCourse ? 'course-breadcrumb' : 'workspace-breadcrumb'}
              style={styles.breadcrumbs}
            >
              <Pressable
                testID="workspace-breadcrumb-organizations"
                accessibilityRole="button"
                accessibilityLabel="Back to organizations"
                onPress={() => selectDestination('Organizations')}
                style={styles.breadcrumbAction}
              >
                <Text style={styles.breadcrumb}>Organizations</Text>
              </Pressable>
              {destination === 'Courses' && (
                <>
                  <Text style={styles.breadcrumb}>/</Text>
                  <Pressable
                    testID="workspace-breadcrumb-organization"
                    accessibilityRole="button"
                    accessibilityLabel="Open Miris organization courses"
                    onPress={() => selectDestination('Courses')}
                    style={styles.breadcrumbAction}
                  >
                    <Text style={styles.breadcrumb}>
                      {DEFAULT_ORGANIZATION}
                    </Text>
                  </Pressable>
                  {inCourse && (
                    <>
                      <Text style={styles.breadcrumb}>/</Text>
                      <Pressable
                        testID="workspace-breadcrumb-courses"
                        accessibilityRole="button"
                        accessibilityLabel="Back to courses"
                        onPress={() => selectDestination('Courses')}
                        style={styles.breadcrumbAction}
                      >
                        <Text style={styles.breadcrumb}>Courses</Text>
                      </Pressable>
                    </>
                  )}
                  {inCourse && (
                    <>
                      <Text style={styles.breadcrumb}>/</Text>
                      <Text style={styles.current}>{COURSE_TITLE}</Text>
                    </>
                  )}
                </>
              )}
            </View>
          )}
          {!inCourse &&
            (destination === 'Organizations' || destination === 'Courses') && (
              <WorkspaceHome
                organizations={destination === 'Organizations'}
                courseAvailable={catalog.length > 0}
                modules={catalog.flatMap(guide =>
                  guide.pack.procedures.map(procedure => ({
                    id: `${guide.id}:${procedure.id}`,
                    title: procedure.title,
                  })),
                )}
                onOrganization={() => selectDestination('Courses')}
                onCourse={() => openCourse()}
              />
            )}
          {inCourse && (
            <>
              <View accessibilityRole="tablist" style={styles.tabs}>
                {(['Course', 'Documentation'] as const).map(tab => (
                  <Pressable
                    key={tab}
                    testID={`course-tab-${tab.toLowerCase()}`}
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
              onVoice={() => assistant.current?.toggleVoice()}
              voiceOn={voiceOn}
              question={draft}
              onQuestionChange={setDraft}
              onDocument={document}
              onDownloads={() => selectDestination('Downloads')}
            />
          )}
          <View
            style={!(inCourse && section === 'Course') && styles.hidden}
            accessibilityElementsHidden={!(inCourse && section === 'Course')}
            importantForAccessibility={
              inCourse && section === 'Course' ? 'auto' : 'no-hide-descendants'
            }
          >
            <CourseAssistant
              ref={assistant}
              onVoiceChange={setVoiceOn}
              guide={catalog[0] ?? null}
              question={lastQuestion?.text ?? null}
              requestId={lastQuestion?.id}
              draft={draft}
              onDraftChange={setDraft}
              inline
              active={inCourse && section === 'Course'}
              onOpen={onOpen}
              onDocument={document}
            />
          </View>
          {inCourse && section === 'Course' && (
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
                        steps={procedure.steps.length}
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
          {inCourse && section === 'Documentation' && (
            <CourseDocumentation documents={documents} />
          )}
          {destination === 'Progress' && (
            <WorkspaceProgress
              continuation={continuation}
              onContinue={continueGuide}
            />
          )}
          {destination === 'Downloads' && (
            <CourseDownloads
              sceneAvailable={catalog.length > 0}
              documents={documents}
              moduleCount={moduleCount}
              onBack={() => {
                openCourse('Course');
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
                accessibilityLabel="Explore cell"
                onPress={explore}
                style={styles.helpAction}
              >
                <Text style={styles.helpActionText}>Explore cell</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Browse course modules"
                onPress={() => openCourse('Course')}
                style={styles.helpAction}
              >
                <Text style={styles.helpActionText}>Browse course modules</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Read equipment documentation"
                onPress={() => openCourse('Documentation')}
                style={styles.helpAction}
              >
                <Text style={styles.helpActionText}>
                  Read equipment documentation
                </Text>
              </Pressable>
            </View>
          )}
          {inCourse && <OfflinePreparation showReady />}
          {inCourse && notice && section !== 'Course' && (
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
  breadcrumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: G.unit,
  },
  breadcrumbAction: { minHeight: G.control, justifyContent: 'center' },
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
