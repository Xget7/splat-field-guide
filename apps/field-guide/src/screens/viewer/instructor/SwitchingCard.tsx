import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSwitchSteps } from '../../../features/events/useAppEvent';
import {
  InstructorMode,
  ModeCause,
  SwitchStepState,
  type ModeStatus,
} from '../../../features/events/types';
import { SwitchTitle } from '../../../features/instructor/mode/modeCopy';
import { Icon, IconName } from '../../../ui/Icon';
import { Color, Motion, Space, Type } from '../../../ui/theme';

const RULE = 2;
const ICON_SIZE = 16;
const ENTER = FadeIn.duration(Motion.base);
const EXIT = FadeOut.duration(Motion.base);

export function switchTitleFor(status: ModeStatus): string {
  return status.mode === InstructorMode.switchingToOffline
    ? status.cause === ModeCause.network
      ? SwitchTitle.lostConnection
      : SwitchTitle.toOffline
    : status.cause === ModeCause.recovered
    ? SwitchTitle.toOnline
    : SwitchTitle.toOnlineByUser;
}

export function SwitchingCard({ status }: { status: ModeStatus }) {
  const steps = useSwitchSteps();
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reducedMotion ? undefined : ENTER}
      exiting={reducedMotion ? undefined : EXIT}
      style={styles.switching}
    >
      <Text accessibilityLiveRegion="polite" style={styles.title}>
        {switchTitleFor(status)}
      </Text>
      {steps.map(step => (
        <View key={step.piece} style={styles.step}>
          {step.state === SwitchStepState.starting ? (
            <ActivityIndicator
              size="small"
              color={Color.muted}
              accessible={false}
            />
          ) : step.state === SwitchStepState.ready ? (
            <Icon name={IconName.check} size={ICON_SIZE} color={Color.muted} />
          ) : null}
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.detail,
              step.state === SwitchStepState.fallback && styles.fallback,
            ]}
          >
            {step.label}
          </Text>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  switching: {
    borderLeftWidth: RULE,
    borderLeftColor: Color.accent,
    paddingLeft: Space.md,
    paddingVertical: Space.sm,
    gap: Space.xs,
  },
  title: { ...Type.calloutStrong, color: Color.text },
  step: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  detail: { ...Type.footnote, color: Color.secondaryText, flexShrink: 1 },
  fallback: { color: Color.caution },
});
