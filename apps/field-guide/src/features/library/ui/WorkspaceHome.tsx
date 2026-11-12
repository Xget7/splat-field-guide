import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Icon, IconName } from '../../../ui/Icon';
import type { ContinueRow } from '../domain/library';
import { ContinueCard } from './GuideCards';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';

export const DEFAULT_ORGANIZATION = 'Miris';
export const COURSE_TITLE = 'Automotive Assembly Line';

/** The bundled demo has one organization and one course; it does not imply a remote directory. */
export function WorkspaceHome({
  organizations,
  courseAvailable,
  modules,
  onOrganization,
  onCourse,
}: {
  organizations: boolean;
  courseAvailable: boolean;
  modules: readonly { id: string; title: string }[];
  onOrganization: () => void;
  onCourse: () => void;
}) {
  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {organizations ? 'Organizations' : 'Courses'}
        </Text>
      </View>
      {organizations ? (
        <Pressable
          testID="open-organization-miris"
          accessibilityRole="button"
          accessibilityLabel="Open Miris organization"
          onPress={onOrganization}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <View style={styles.icon}>
            <Icon name={IconName.organization} color={C.accent} size={28} />
          </View>
          <Text style={styles.name}>{DEFAULT_ORGANIZATION}</Text>
          <View style={styles.footer}>
            <Text style={styles.label}>
              {courseAvailable ? '1 course' : 'No courses installed'}
            </Text>
            <Icon name={IconName.next} color={C.secondary} size={20} />
          </View>
        </Pressable>
      ) : courseAvailable ? (
        <Pressable
          testID="open-course-automotive-assembly-line"
          accessibilityRole="button"
          accessibilityLabel={`${COURSE_TITLE}, ${modules.length} modules`}
          onPress={onCourse}
          style={({ pressed }) => [styles.course, pressed && styles.pressed]}
        >
          <Image
            source={require('../assets/assembly-line.jpg')}
            accessibilityLabel="Miris automotive assembly cell"
            style={styles.image}
            resizeMode="cover"
          />
          <View style={styles.courseBody}>
            <Text style={styles.name}>{COURSE_TITLE}</Text>
            <View style={styles.footer}>
              <View style={styles.moduleTiles}>
                {modules.map((module, index) => (
                  <View key={module.id} style={styles.moduleTile}>
                    <Text style={styles.moduleNumber}>
                      {String(index + 1).padStart(2, '0')}
                    </Text>
                    <Text numberOfLines={2} style={styles.moduleName}>
                      {module.title}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.courseArrow}>
                <Icon name={IconName.next} color={C.text} size={32} />
              </View>
            </View>
          </View>
        </Pressable>
      ) : (
        <WorkspaceSkeleton testID="courses-empty" />
      )}
    </View>
  );
}

/** Report only a validated saved activity; this local record is not a completion ledger. */
export function WorkspaceProgress({
  continuation,
  onContinue,
}: {
  continuation: ContinueRow | null;
  onContinue: () => void;
}) {
  return (
    <View style={styles.page}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          My progress
        </Text>
      </View>
      {continuation ? (
        <View style={styles.progress}>
          <Text style={styles.caption}>{continuation.guide.title}</Text>
          <ContinueCard row={continuation} onPress={onContinue} />
        </View>
      ) : (
        <WorkspaceSkeleton testID="progress-empty" />
      )}
    </View>
  );
}

function WorkspaceSkeleton({ testID }: { testID: string }) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    opacity.value = reducedMotion
      ? 0.45
      : withRepeat(withTiming(0.8, { duration: 1200 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity, reducedMotion]);
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, pulse]}
    >
      <View style={styles.skeletonIcon} />
      <View style={styles.skeletonTitle} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonTrack} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { gap: G.large },
  progress: { maxWidth: 720, gap: G.small },
  skeleton: {
    width: '100%',
    maxWidth: 560,
    gap: G.small,
    padding: G.medium,
    borderRadius: R.card,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  skeletonIcon: {
    width: 48,
    height: 48,
    borderRadius: R.control,
    backgroundColor: C.raised,
  },
  skeletonTitle: {
    width: '56%',
    height: 24,
    borderRadius: G.unit,
    backgroundColor: C.raised,
  },
  skeletonLine: {
    width: '32%',
    height: 16,
    borderRadius: G.unit,
    backgroundColor: C.raised,
  },
  skeletonTrack: {
    height: 8,
    borderRadius: G.unit,
    backgroundColor: C.raised,
    marginTop: G.unit,
  },
  heading: { gap: G.unit },
  title: { ...T.title, color: C.text },
  name: { ...T.heading, color: C.text },
  caption: { ...T.body, color: C.secondary },
  label: { ...T.label, color: C.text },
  card: {
    width: '100%',
    maxWidth: 400,
    gap: G.small,
    padding: G.medium,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.card,
    backgroundColor: C.surface,
  },
  icon: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.raised,
    borderRadius: R.control,
  },
  footer: {
    marginTop: G.unit,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: G.small,
  },
  course: {
    width: '100%',
    maxWidth: 560,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.card,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  image: { width: '100%', height: 240, opacity: 0.85 },
  courseBody: { gap: G.small, padding: G.medium },
  moduleTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: G.unit, flex: 1 },
  moduleTile: {
    flexBasis: '45%',
    flexGrow: 1,
    minWidth: 96,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: G.unit,
    padding: G.unit,
    borderRadius: R.control,
    backgroundColor: C.raised,
    borderWidth: 1,
    borderColor: C.border,
  },
  moduleNumber: {
    fontSize: 10,
    lineHeight: 14,
    color: C.accent,
    fontWeight: '600',
  },
  moduleName: { fontSize: 11, lineHeight: 14, color: C.text, flex: 1 },
  courseArrow: {
    width: G.control + G.unit,
    height: G.control + G.unit,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.pill,
    backgroundColor: C.raised,
  },
  pressed: { backgroundColor: C.raised },
});
