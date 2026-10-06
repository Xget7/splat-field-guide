import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { Button, IconButton, IconButtonVariant } from '../../ui/Button';
import { IconName } from '../../ui/Icon';
import { Label } from '../../ui/Label';
import { BUTTON_HEIGHT, Color, HAIRLINE, Space, Type } from '../../ui/theme';
import { CautionNote } from './instructor/CautionNote';
import type { CardContent } from './guideContent';
import { StepSegments } from './StepSegments';
import { stepLabel } from '../../ui/readout';

const SWIPE_ACTIVATION_POINTS = 24;
const SWIPE_DISTANCE_POINTS = 64;
const SWIPE_VERTICAL_TOLERANCE_POINTS = 16;
// Limit panel height to keep the splat visible even for long steps.
const MAX_PANEL_SHARE = '55%';

interface Props {
  content: CardContent;
  bottomInset: number;
  onBack: () => void;
  onNext: () => void;
  onRepeat: () => void;
  /** The sidebar step list already shows progress. */
  docked?: boolean;
}

export function StepPanel({
  content,
  bottomInset,
  onBack,
  onNext,
  onRepeat,
  docked = false,
}: Props) {
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
      // Swiping never finishes a procedure: that takes the button.
      if (
        event.translationX <= -SWIPE_DISTANCE_POINTS &&
        !content.nextDisabled &&
        !content.last
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
  const hasStep = content.stepCount > 0;

  return (
    <GestureDetector gesture={swipe}>
      <View
        testID="step-panel"
        style={[
          styles.panel,
          docked && styles.docked,
          { paddingBottom: bottomInset + Space.md },
        ]}
      >
        <View style={styles.header}>
          <Label testID="step-counter" color={Color.accent}>
            {hasStep
              ? stepLabel(content.stepNumber, content.stepCount)
              : 'Overview'}
          </Label>
          {content.selected && <Label color={Color.muted}>Selected</Label>}
        </View>
        {hasStep && !docked && (
          <StepSegments
            count={content.stepCount}
            current={content.stepNumber - 1}
          />
        )}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.text}>
          <Text
            testID="step-title"
            accessibilityRole="header"
            style={styles.title}
          >
            {content.title}
          </Text>
          <Text style={styles.body}>{content.body}</Text>
          {content.caution !== '' && <CautionNote text={content.caution} />}
        </ScrollView>
        <View style={styles.buttons}>
          <IconButton
            testID="step-back"
            icon={IconName.back}
            accessibilityLabel="Previous step"
            size={BUTTON_HEIGHT}
            disabled={content.backDisabled}
            onPress={onBack}
          />
          <IconButton
            testID="step-repeat"
            icon={IconName.repeat}
            accessibilityLabel={
              content.selected ? 'Back to step' : 'Show again'
            }
            variant={IconButtonVariant.raised}
            size={BUTTON_HEIGHT}
            disabled={!hasStep}
            onPress={onRepeat}
          />
          <Button
            testID="step-next"
            label={content.last ? 'Finish' : 'Next'}
            icon={content.last ? IconName.check : undefined}
            disabled={content.nextDisabled}
            onPress={onNext}
            style={styles.next}
          />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  panel: {
    maxHeight: MAX_PANEL_SHARE,
    flexShrink: 1,
    paddingTop: Space.lg,
    paddingHorizontal: Space.lg,
    gap: Space.md,
    backgroundColor: Color.black,
    borderTopWidth: HAIRLINE,
    borderTopColor: Color.line,
  },
  docked: { marginTop: 'auto' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  text: { gap: Space.sm, paddingTop: Space.xs },
  title: { ...Type.title, color: Color.text },
  body: { ...Type.body, color: Color.secondaryText },
  buttons: { flexDirection: 'row', gap: Space.sm, paddingTop: Space.xs },
  next: { flex: 1 },
});
