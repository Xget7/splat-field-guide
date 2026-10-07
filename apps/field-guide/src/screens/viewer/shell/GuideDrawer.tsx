import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, IconButton } from '../../../ui/Button';
import { Icon, IconName } from '../../../ui/Icon';
import {
  BUTTON_HEIGHT,
  Color,
  MIN_TOUCH,
  Radius,
  Space,
  Type,
} from '../../../ui/theme';
import type { CardContent, StepRow } from '../guideContent';
import { StepList } from '../StepList';
import { Drawer } from './Drawer';

const TITLE = 'Guide';
const PROCEDURE_LABEL = 'Procedure';
const CHOOSE_HINT = 'Choose another procedure';
const BACK_LABEL = 'Previous step';
const BACK_HINT = 'Return to the previous instruction';
const NEXT_LABEL = 'Next';
const NEXT_HINT = 'Continue to the next instruction';
const FINISH_LABEL = 'Finish';
const FINISH_HINT = 'Finish this procedure and return to the library';
const CHEVRON_SIZE = 14;

interface Props {
  topInset: number;
  bottomInset: number;
  procedureTitle: string;
  onChooseProcedure: () => void;
  steps: readonly StepRow[];
  current: number;
  onGoTo: (index: number) => void;
  content: CardContent;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function GuideDrawer({
  topInset,
  bottomInset,
  procedureTitle,
  onChooseProcedure,
  steps,
  current,
  onGoTo,
  content,
  onBack,
  onNext,
  onClose,
}: Props) {
  return (
    <Drawer
      title={TITLE}
      icon={IconName.list}
      topInset={topInset}
      bottomInset={bottomInset}
      onClose={onClose}
      footer={
        <View style={styles.buttons}>
          <IconButton
            testID="step-back"
            icon={IconName.back}
            accessibilityLabel={BACK_LABEL}
            accessibilityHint={BACK_HINT}
            size={BUTTON_HEIGHT}
            disabled={content.backDisabled}
            onPress={onBack}
            style={styles.back}
          />
          <Button
            testID="step-next"
            label={content.last ? FINISH_LABEL : NEXT_LABEL}
            accessibilityLabel={content.last ? FINISH_LABEL : NEXT_LABEL}
            accessibilityHint={content.last ? FINISH_HINT : NEXT_HINT}
            disabled={content.nextDisabled}
            onPress={onNext}
            style={styles.next}
          />
        </View>
      }
    >
      <Pressable
        testID="procedure-button"
        accessibilityRole="button"
        accessibilityLabel={`${PROCEDURE_LABEL}: ${procedureTitle}`}
        accessibilityHint={CHOOSE_HINT}
        accessibilityState={{ disabled: false }}
        onPress={onChooseProcedure}
        style={({ pressed }) => [styles.procedure, pressed && styles.pressed]}
      >
        <Text numberOfLines={1} style={styles.procedureTitle}>
          {procedureTitle}
        </Text>
        <Icon name={IconName.down} size={CHEVRON_SIZE} color={Color.muted} />
      </Pressable>
      <StepList rows={steps} current={current} onSelect={onGoTo} expanded />
    </Drawer>
  );
}

const styles = StyleSheet.create({
  procedure: {
    minHeight: MIN_TOUCH,
    marginHorizontal: Space.lg,
    marginBottom: Space.lg,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: Color.field,
    borderRadius: Radius.field,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.line,
  },
  procedureTitle: { ...Type.callout, flex: 1, color: Color.text },
  pressed: { backgroundColor: Color.pressed },
  buttons: { flexDirection: 'row', gap: Space.sm },
  back: { backgroundColor: Color.field },
  next: { flex: 1 },
});
