import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Button, IconButton, IconButtonVariant } from '../../../ui/Button';
import { IconName } from '../../../ui/Icon';
import { BUTTON_HEIGHT, Space } from '../../../ui/theme';
import type { CardContent } from '../../guide';

/** The ids and words of one place that shows step controls. */
export interface StepControlsSite {
  readonly backId: string;
  readonly nextId: string;
  readonly back: string;
  readonly backHint?: string;
  readonly next: string;
  readonly finish: string;
  /** Spoken in place of the visible Next or Finish word, when it says more. */
  readonly nextLabel?: string;
  readonly finishLabel?: string;
  readonly nextHint?: string;
  readonly finishHint?: string;
  /** Finish carries a check, except where a hint already says what it does. */
  readonly finishIcon: boolean;
}

const BACK = 'Previous step';
const NEXT = 'Next';
const FINISH = 'Finish';

export const StepControlsSites = {
  panel: {
    backId: 'step-back',
    nextId: 'step-next',
    back: BACK,
    next: NEXT,
    finish: FINISH,
    finishIcon: true,
  },
  drawer: {
    backId: 'step-back',
    nextId: 'step-next',
    back: BACK,
    backHint: 'Return to the previous instruction',
    next: NEXT,
    finish: FINISH,
    nextLabel: NEXT,
    finishLabel: FINISH,
    nextHint: 'Continue to the next instruction',
    finishHint: 'Finish this procedure and return to the library',
    finishIcon: false,
  },
  instructor: {
    backId: 'instructor-back',
    nextId: 'instructor-next',
    back: BACK,
    next: NEXT,
    finish: FINISH,
    nextLabel: 'Next step',
    finishLabel: 'Finish procedure',
    finishIcon: true,
  },
} as const satisfies Record<string, StepControlsSite>;

interface Props {
  site: StepControlsSite;
  content: CardContent;
  onBack: () => void;
  onNext: () => void;
  /** Only the round Next button, for a bar with no room for Back. */
  compact?: boolean;
  /** Between Back and Next, such as the panel's Repeat. */
  children?: ReactNode;
  style?: ViewStyle;
  backStyle?: ViewStyle;
}

/** Back and Next for the current step; on the last step Next finishes the procedure. */
export function StepControls({
  site,
  content,
  onBack,
  onNext,
  compact = false,
  children,
  style,
  backStyle,
}: Props) {
  const { last } = content;
  const nextLabel = last ? site.finishLabel : site.nextLabel;
  if (compact) {
    return (
      <IconButton
        testID={site.nextId}
        icon={last ? IconName.check : IconName.next}
        accessibilityLabel={nextLabel ?? (last ? site.finish : site.next)}
        disabled={content.nextDisabled}
        variant={IconButtonVariant.primary}
        onPress={onNext}
      />
    );
  }
  return (
    <View style={[styles.row, style]}>
      <IconButton
        testID={site.backId}
        icon={IconName.back}
        accessibilityLabel={site.back}
        accessibilityHint={site.backHint}
        size={BUTTON_HEIGHT}
        disabled={content.backDisabled}
        onPress={onBack}
        style={backStyle}
      />
      {children}
      <Button
        testID={site.nextId}
        label={last ? site.finish : site.next}
        icon={last && site.finishIcon ? IconName.check : undefined}
        accessibilityLabel={nextLabel}
        accessibilityHint={last ? site.finishHint : site.nextHint}
        disabled={content.nextDisabled}
        onPress={onNext}
        style={styles.next}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Space.sm },
  next: { flex: 1 },
});
