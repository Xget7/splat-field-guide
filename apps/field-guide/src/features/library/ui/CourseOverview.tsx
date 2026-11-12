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
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';
import { CourseComposer } from './CourseComposer';

export function CourseOverview({
  wide,
  onExplore,
  onAsk,
  onDocument,
  onDownloads,
  question,
  onQuestionChange,
}: {
  wide: boolean;
  onExplore: () => void;
  onAsk: (question: string) => void;
  onDocument: () => void;
  onDownloads: () => void;
  question: string;
  onQuestionChange: (question: string) => void;
}) {
  const rotation = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!reduced) {
      rotation.value = withRepeat(withTiming(360, { duration: 12000 }), -1);
    }
    return () => cancelAnimation(rotation);
  }, [reduced, rotation]);
  const cubeStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${rotation.value}deg` }],
  }));
  return (
    <View style={[styles.hero, wide && styles.wide]}>
      <View style={[styles.photo, wide && styles.photoWide]}>
        <Image
          accessibilityLabel="KUKA robots around a vehicle body in the Miris reference scene"
          source={require('../assets/assembly-line.jpg')}
          style={styles.image}
          resizeMode="cover"
        />
        <View pointerEvents="none" style={styles.dim} />
        <Pressable
          testID="course-explore"
          accessibilityRole="button"
          onPress={onExplore}
          style={styles.explore}
        >
          <Animated.View style={cubeStyle}>
            <Icon name={IconName.explore} size={16} color={C.text} />
          </Animated.View>
          <Text style={styles.label}>Explore in 3D</Text>
        </Pressable>
      </View>
      <View style={styles.details}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.title}>
            Automotive{wide ? '\n' : ' '}Assembly Line
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Course downloads"
            onPress={onDownloads}
            style={styles.download}
          >
            <Icon name={IconName.down} color={C.secondary} />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage course offline availability"
          onPress={onDownloads}
          style={styles.availability}
        >
          <Text style={styles.availabilityText}>Not available offline</Text>
          <Icon name={IconName.next} size={16} color={C.secondary} />
        </Pressable>
        <CourseComposer
          onAsk={onAsk}
          onDocument={onDocument}
          question={question}
          onQuestionChange={onQuestionChange}
        />
      </View>
    </View>
  );
}
export function ModuleCard({
  title,
  index,
  onPress,
  testID,
  details,
  action = 'Open module',
  wide = false,
}: {
  title: string;
  details?: string;
  action?: string;
  wide?: boolean;
  index: number;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Open module, ${title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        wide && styles.cardWide,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.titleRow}>
        <Icon
          name={index === 0 ? IconName.explore : IconName.list}
          color={C.secondary}
          size={24}
        />
        <Text style={styles.number}>{String(index + 1).padStart(2, '0')}</Text>
      </View>
      <Text style={styles.moduleTitle}>{title}</Text>
      {details && <Text style={styles.moduleDetails}>{details}</Text>}
      <View style={styles.cardFooter}>
        <Text style={styles.label}>{action}</Text>
        <Icon name={IconName.next} color={C.secondary} size={16} />
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  hero: { gap: G.large },
  wide: { flexDirection: 'row', alignItems: 'stretch' },
  photo: {
    height: 352,
    borderRadius: R.card,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  photoWide: { flex: 1, height: undefined, minHeight: 352 },
  image: { width: '100%', height: '100%', position: 'absolute' },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.2)' },
  explore: {
    position: 'absolute',
    bottom: G.small,
    right: G.small,
    minHeight: G.control,
    paddingHorizontal: G.small,
    borderRadius: R.pill,
    flexDirection: 'row',
    gap: G.unit,
    alignItems: 'center',
    backgroundColor: C.overlay,
    borderWidth: 1,
    borderColor: C.border,
  },
  details: { flex: 1, gap: G.medium },
  availability: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: G.control,
    gap: G.unit,
  },
  availabilityText: { ...T.caption, color: C.secondary },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: G.unit,
  },
  title: { ...T.title, color: C.text, flex: 1 },
  download: {
    width: G.control,
    height: G.control,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: { ...T.label, color: C.text },
  card: {
    flex: 1,
    padding: G.medium,
    gap: G.medium,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  cardWide: { flexBasis: '40%' },
  moduleDetails: { ...T.caption, color: C.secondary },
  pressed: { backgroundColor: C.raised },
  number: { ...T.caption, color: C.secondary },
  moduleTitle: { ...T.heading, color: C.text, flex: 1 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: G.unit,
  },
});
