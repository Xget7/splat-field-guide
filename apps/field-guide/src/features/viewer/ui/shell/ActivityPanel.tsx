import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { IconButton } from '../../../../ui/Button';
import { CautionNote } from '../../../../ui/CautionNote';
import { IconName } from '../../../../ui/Icon';
import { Color, Radius, Space, Type } from '../../../../ui/theme';
import { stepLabel, type CardContent } from '../../../guide';
import { StepControls, StepControlsSites } from '../StepControls';

interface Props {
  procedureTitle: string;
  content: CardContent;
  detail?: string;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}

/** Keep the current instruction readable without dedicating a column to a step index. */
export function ActivityPanel({
  procedureTitle,
  content,
  detail,
  onBack,
  onNext,
  onClose,
}: Props) {
  return (
    <View testID="activity-panel" style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.context}>
          <Text style={styles.procedure}>{procedureTitle}</Text>
          <Text testID="activity-counter" style={styles.counter}>
            {stepLabel(content.stepNumber, content.stepCount)}
          </Text>
        </View>
        <IconButton
          testID="activity-close"
          icon={IconName.close}
          accessibilityLabel="Hide activity"
          onPress={onClose}
        />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.text}>
        <Text accessibilityRole="header" style={styles.title}>
          {content.title}
        </Text>
        {content.body !== '' && <Text style={styles.body}>{content.body}</Text>}
        {!!detail && detail !== content.body && (
          <Text style={styles.body}>{detail}</Text>
        )}
        {content.caution !== '' && <CautionNote text={content.caution} />}
      </ScrollView>
      <StepControls
        site={StepControlsSites.drawer}
        content={content}
        onBack={onBack}
        onNext={onNext}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '100%',
    padding: Space.lg,
    gap: Space.md,
    borderRadius: Radius.card,
    backgroundColor: Color.drawer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Color.line,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  context: { flex: 1, gap: Space.xs },
  procedure: { ...Type.label, color: Color.secondaryText },
  counter: { ...Type.footnote, color: Color.accent },
  scroll: { flexGrow: 0, flexShrink: 1, maxHeight: 240 },
  text: { gap: Space.sm },
  title: { ...Type.title, color: Color.text },
  body: { ...Type.body, color: Color.secondaryText },
});
