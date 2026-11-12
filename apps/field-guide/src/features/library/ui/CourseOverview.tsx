import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
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
  onVoice,
  voiceOn,
  onDocument,
  onDownloads,
  question,
  onQuestionChange,
}: {
  wide: boolean;
  onExplore: () => void;
  onAsk: (question: string) => void;
  onVoice?: () => void;
  voiceOn?: boolean;
  onDocument: () => void;
  onDownloads: () => void;
  question: string;
  onQuestionChange: (question: string) => void;
}) {
  return (
    <View style={styles.hero}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.title}>
          Automotive Assembly Line
        </Text>
        <Pressable
          testID="course-download"
          accessibilityRole="button"
          accessibilityLabel="Download course"
          accessibilityHint="View local files and course download availability"
          onPress={onDownloads}
          style={({ pressed }) => [
            styles.download,
            pressed && styles.downloadPressed,
          ]}
        >
          <Icon name={IconName.download} size={20} color={C.secondary} />
        </Pressable>
      </View>
      <View style={[styles.body, wide && styles.wide]}>
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
            <Text style={styles.label}>Explore</Text>
            <Icon name={IconName.next} size={24} color={C.white} />
          </Pressable>
        </View>
        <View style={styles.details}>
          <CourseComposer
            onAsk={onAsk}
            onVoice={onVoice}
            voiceOn={voiceOn}
            onDocument={onDocument}
            question={question}
            onQuestionChange={onQuestionChange}
          />
        </View>
      </View>
    </View>
  );
}
export function ModuleCard({
  title,
  index,
  onPress,
  testID,
  steps,
  action = 'Open module',
  wide = false,
}: {
  title: string;
  steps?: number;
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
      accessibilityLabel={`Open module, ${title}${
        steps === undefined ? '' : `, ${steps} steps`
      }, module ${index + 1}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        wide && styles.cardWide,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.titleRow}>
        <Icon name={IconName.course} color={C.secondary} size={24} />
        {steps !== undefined && (
          <View style={styles.stepCount}>
            <Icon name={IconName.list} color={C.secondary} size={14} />
            <Text style={styles.number}>{steps}</Text>
          </View>
        )}
      </View>
      <Text style={styles.moduleTitle}>{title}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.label}>{action}</Text>
        <Icon name={IconName.next} color={C.accent} size={16} />
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  hero: { gap: G.medium },
  body: { gap: G.medium },
  wide: { flexDirection: 'row', alignItems: 'flex-start' },
  photo: {
    height: 320,
    borderRadius: R.card,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  photoWide: { flex: 1, height: 320 },
  image: { width: '100%', height: '100%', position: 'absolute' },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.2)' },
  explore: {
    position: 'absolute',
    bottom: G.small,
    right: G.small,
    minHeight: G.control,
    paddingHorizontal: G.small,
    borderRadius: R.control,
    flexDirection: 'row',
    gap: G.unit,
    alignItems: 'center',
    backgroundColor: C.primary,
    borderWidth: 1,
    borderColor: C.accent,
  },
  details: { flex: 1 },
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
    borderRadius: R.control,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadPressed: { backgroundColor: C.raised },
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
  stepCount: { flexDirection: 'row', alignItems: 'center', gap: G.unit },
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
