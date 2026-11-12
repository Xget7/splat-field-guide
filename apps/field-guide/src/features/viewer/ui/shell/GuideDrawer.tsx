import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, IconName } from '../../../../ui/Icon';
import { Color, Radius, Space, Type } from '../../../../ui/theme';
import type { CardContent, StepRow } from '../../../guide';
import { StepControls, StepControlsSites } from '../StepControls';
import { StepList } from '../StepList';
import { Drawer } from './Drawer';
import { CHEVRON_SIZE } from './layout';

const TITLE = 'Guide';
const PROCEDURE_LABEL = 'Procedure';
const CHOOSE_HINT = 'Choose another procedure';

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
  instructorOpen?: boolean;
  onToggleInstructor?: () => void;
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
  instructorOpen = false,
  onToggleInstructor,
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
      {onToggleInstructor && (
        <View style={styles.guidance}>
          <Text style={styles.guidanceLabel}>Guidance</Text>
          <View style={styles.modes}>
            {[
              {
                id: 'instructor',
                title: 'Instructor',
                selected: instructorOpen,
              },
              {
                id: 'self-guided',
                title: 'Self-guided',
                selected: !instructorOpen,
              },
            ].map(option => (
              <Pressable
                key={option.id}
                testID={`guidance-${option.id}`}
                accessibilityRole="button"
                accessibilityLabel={option.title}
                accessibilityState={{ selected: option.selected }}
                onPress={() => {
                  if (!option.selected) onToggleInstructor();
                }}
                style={[styles.mode, option.selected && styles.modeSelected]}
              >
                <Text style={styles.modeTitle}>{option.title}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.guidanceCaption}>
            {instructorOpen
              ? 'Ask about the selected part or current step.'
              : 'Follow the steps at your own pace.'}
          </Text>
        </View>
      )}
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
  guidance: {
    marginHorizontal: Space.lg,
    marginBottom: Space.lg,
    gap: Space.sm,
  },
  guidanceLabel: { ...Type.label, color: Color.secondaryText },
  modes: {
    flexDirection: 'row',
    gap: Space.xs,
    padding: Space.xs,
    backgroundColor: Color.field,
    borderRadius: Radius.control,
  },
  mode: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.control,
  },
  modeSelected: { backgroundColor: Color.accentFill },
  modeTitle: { ...Type.label, color: Color.text },
  guidanceCaption: { ...Type.footnote, color: Color.secondaryText },
  procedure: {
    minHeight: 48,
    marginHorizontal: Space.lg,
    marginBottom: Space.lg,
    paddingHorizontal: Space.lg,
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
