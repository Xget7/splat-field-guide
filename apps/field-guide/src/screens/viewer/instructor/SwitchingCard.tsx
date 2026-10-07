import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSwitchSteps } from '../../../features/events/useAppEvent';
import { SwitchStepState } from '../../../features/events/types';
import { Icon, IconName } from '../../../ui/Icon';
import { Color, Space, Type } from '../../../ui/theme';

const INDICATOR_SIZE = 20;

export function SwitchingCard({ title }: { title: string | null }) {
  const steps = useSwitchSteps();
  return (
    <>
      <Text accessibilityLiveRegion="polite" style={styles.title}>
        {title}
      </Text>
      {steps.map(step => (
        <View key={step.piece} style={styles.step}>
          <View style={styles.indicator}>
            {step.state === SwitchStepState.starting && (
              <ActivityIndicator
                size="small"
                color={Color.muted}
                accessible={false}
              />
            )}
            {step.state === SwitchStepState.ready && (
              <Icon
                name={IconName.check}
                size={INDICATOR_SIZE}
                color={Color.muted}
              />
            )}
          </View>
          <Text
            style={[
              styles.detail,
              step.state === SwitchStepState.fallback && styles.fallback,
            ]}
          >
            {step.label}
          </Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  title: { ...Type.calloutStrong, color: Color.text },
  step: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  indicator: {
    width: INDICATOR_SIZE,
    height: INDICATOR_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detail: { ...Type.footnote, color: Color.secondaryText, flexShrink: 1 },
  fallback: { color: Color.caution },
});
