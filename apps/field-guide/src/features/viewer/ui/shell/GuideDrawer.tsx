import { Pressable, StyleSheet, Text } from 'react-native';
import { Icon, IconName } from '../../../../ui/Icon';
import { Color, MIN_TOUCH, Radius, Space, Type } from '../../../../ui/theme';
import type { CardContent, StepRow } from '../../../guide';
import { StepControls, StepControlsSites } from '../StepControls';
import { StepList } from '../StepList';
import { Drawer } from './Drawer';

const TITLE = 'Guide';
const PROCEDURE_LABEL = 'Procedure';
const CHOOSE_HINT = 'Choose another procedure';
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
        <StepControls
          site={StepControlsSites.drawer}
          content={content}
          onBack={onBack}
          onNext={onNext}
          backStyle={styles.back}
        />
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
  back: { backgroundColor: Color.field },
});
