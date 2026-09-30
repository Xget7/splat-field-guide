import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardKind, type CardContent } from './guideContent';
import { GuideButton } from './GuideButton';
import { StepProgress } from './StepProgress';
import { Color, FontSize, Space } from './theme';

const SWIPE_ACTIVATION_POINTS = 24;
const SWIPE_DISTANCE_POINTS = 64;
const SWIPE_VERTICAL_TOLERANCE_POINTS = 16;

interface Props {
  content: CardContent;
  onBack: () => void;
  onNext: () => void;
  onRepeat: () => void;
}

export function StepCard({ content, onBack, onNext, onRepeat }: Props) {
  const insets = useSafeAreaInsets();
  const swipe = usePanGesture({
    runOnJS: true,
    maxPointers: 1,
    activeOffsetX: [-SWIPE_ACTIVATION_POINTS, SWIPE_ACTIVATION_POINTS],
    failOffsetY: [
      -SWIPE_VERTICAL_TOLERANCE_POINTS,
      SWIPE_VERTICAL_TOLERANCE_POINTS,
    ],
    onDeactivate: event => {
      if (event.canceled) {
        return;
      }
      if (
        event.translationX <= -SWIPE_DISTANCE_POINTS &&
        !content.nextDisabled
      ) {
        onNext();
      } else if (
        event.translationX >= SWIPE_DISTANCE_POINTS &&
        !content.backDisabled
      ) {
        onBack();
      }
    },
  });

  return (
    <GestureDetector gesture={swipe}>
      <View
        testID="guide-card"
        style={[styles.card, { paddingBottom: insets.bottom + Space.lg }]}
      >
        <StepProgress
          stepNumber={content.stepNumber}
          stepCount={content.stepCount}
        />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
        >
          <Text
            testID="guide-title"
            accessibilityRole="header"
            style={[
              styles.title,
              content.kind === CardKind.procedure && styles.procedureTitle,
            ]}
          >
            {content.title}
          </Text>
          <Text style={styles.body}>{content.body}</Text>
          {content.caution !== '' && (
            <Text style={styles.caution}>Caution: {content.caution}</Text>
          )}
          {content.selected && (
            <GuideButton
              label="Back to step"
              testID="guide-repeat"
              onPress={onRepeat}
            />
          )}
        </ScrollView>
        <View style={styles.buttons}>
          <GuideButton
            label="Back"
            testID="guide-back"
            fillRow
            disabled={content.backDisabled}
            onPress={onBack}
          />
          <GuideButton
            label={content.nextLabel}
            testID="guide-next"
            fillRow
            primary
            disabled={content.nextDisabled}
            onPress={onNext}
          />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    maxHeight: '60%',
    flexShrink: 1,
    backgroundColor: Color.surface,
    borderTopLeftRadius: Space.xl,
    borderTopRightRadius: Space.xl,
    padding: Space.xl,
    gap: Space.lg,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: Space.md },
  title: {
    color: Color.text,
    fontSize: FontSize.title,
    lineHeight: 32,
    fontWeight: '700',
  },
  procedureTitle: {
    color: Color.accent,
    fontSize: FontSize.small,
    lineHeight: 20,
    fontWeight: '600',
  },
  body: { color: Color.text, fontSize: FontSize.body, lineHeight: 24 },
  caution: { color: Color.caution, fontSize: FontSize.small, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: Space.md },
});
