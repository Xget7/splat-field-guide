import { useCallback, useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Icon, IconName } from '../../../ui/Icon';
import { CautionNote } from '../../../ui/CautionNote';
import { Color, Radius, Space, Type } from '../../../ui/theme';
import type { StepRow } from '../../guide';
import { ROW_HEIGHT, SCROLL_EVENT_THROTTLE_MS } from './shell/layout';

const BADGE_SIZE = 24;
const CHECK_SIZE = 14;
const SELECT_HINT = 'Show this step';
const STEP_LABEL = 'Step';
const SAFETY_LABEL = 'has a safety note';

// Earlier steps may have been skipped, so the spoken state does not imply completion.
const StepState = {
  earlier: 'earlier',
  current: 'current',
  upcoming: 'upcoming',
} as const;
type StepState = (typeof StepState)[keyof typeof StepState];

const SPOKEN_STATE: Readonly<Record<StepState, string>> = {
  earlier: 'earlier step',
  current: 'current step',
  upcoming: 'not started',
};

const TEXT_COLOR: Readonly<Record<StepState, string>> = {
  earlier: Color.muted,
  current: Color.text,
  upcoming: Color.text,
};

function stateOf(index: number, current: number): StepState {
  if (index < current) {
    return StepState.earlier;
  }
  return index === current ? StepState.current : StepState.upcoming;
}

function Badge({ index, state }: { index: number; state: StepState }) {
  return (
    <View
      style={[styles.badge, state === StepState.current && styles.badgeCurrent]}
    >
      {state === StepState.earlier ? (
        <Icon
          name={IconName.check}
          size={CHECK_SIZE}
          color={Color.secondaryText}
        />
      ) : (
        <Text
          style={[
            styles.number,
            state === StepState.current && styles.numberCurrent,
          ]}
        >
          {index + 1}
        </Text>
      )}
    </View>
  );
}

export function StepList({
  rows,
  current,
  onSelect,
  expanded = false,
}: {
  rows: readonly StepRow[];
  /** Zero based. */
  current: number;
  onSelect: (index: number) => void;
  /** Include current detail and caution when this list owns the step presentation. */
  expanded?: boolean;
}) {
  const scroll = useRef<ScrollViewInstance>(null);
  const tops = useRef<number[]>([]);
  const heights = useRef<number[]>([]);
  const offset = useRef(0);
  const visible = useRef(0);
  const reducedMotion = useReducedMotion();
  const revealCurrent = useCallback(() => {
    const top = tops.current[current];
    const height = heights.current[current];
    if (top === undefined || height === undefined || visible.current <= 0) {
      return;
    }
    if (top < offset.current || height > visible.current) {
      scroll.current?.scrollTo({ y: top, animated: !reducedMotion });
    } else if (top + height > offset.current + visible.current) {
      scroll.current?.scrollTo({
        y: Math.max(0, top + height - visible.current),
        animated: !reducedMotion,
      });
    }
  }, [current, reducedMotion]);
  useEffect(revealCurrent, [revealCurrent, rows, expanded]);

  return (
    <View testID="step-list" style={styles.list}>
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={styles.rows}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        onLayout={event => {
          visible.current = event.nativeEvent.layout.height;
          revealCurrent();
        }}
        onContentSizeChange={revealCurrent}
        onScroll={event => {
          offset.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
      >
        {rows.map((row, index) => {
          const state = stateOf(index, current);
          const whole = expanded && state === StepState.current;
          return (
            <View
              key={row.id}
              testID={`step-group-${index}`}
              onLayout={event => {
                tops.current[index] = event.nativeEvent.layout.y;
                heights.current[index] = event.nativeEvent.layout.height;
                if (index === current) {
                  revealCurrent();
                }
              }}
            >
              <Pressable
                testID={`step-row-${index}`}
                accessibilityRole="button"
                accessibilityLabel={`${STEP_LABEL} ${index + 1} of ${
                  rows.length
                }, ${SPOKEN_STATE[state]}: ${row.text}${
                  row.caution !== '' ? `, ${SAFETY_LABEL}` : ''
                }`}
                accessibilityHint={SELECT_HINT}
                accessibilityState={{ selected: state === StepState.current }}
                onPress={() => onSelect(index)}
                style={({ pressed }) => [
                  styles.row,
                  state === StepState.current && styles.rowCurrent,
                  pressed && styles.rowPressed,
                ]}
              >
                <Badge index={index} state={state} />
                <Text
                  testID={whole ? 'step-current-text' : undefined}
                  style={[styles.text, { color: TEXT_COLOR[state] }]}
                >
                  {row.text}
                </Text>
              </Pressable>
              {whole && (row.detail !== '' || row.caution !== '') && (
                <View style={styles.detailBlock}>
                  {row.detail !== '' && (
                    <Text testID="step-current-detail" style={styles.detail}>
                      {row.detail}
                    </Text>
                  )}
                  {row.caution !== '' && <CautionNote text={row.caution} />}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  scroll: { flex: 1 },
  rows: { gap: Space.sm, paddingHorizontal: Space.lg, paddingBottom: Space.lg },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowCurrent: {
    backgroundColor: Color.raised,
    borderColor: Color.accent,
  },
  rowPressed: { backgroundColor: Color.pressed },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCurrent: { backgroundColor: Color.accentFill },
  number: { ...Type.data, color: Color.muted },
  numberCurrent: { color: Color.accentText },
  text: { ...Type.callout, flex: 1 },
  detailBlock: {
    marginLeft: Space.lg + BADGE_SIZE + Space.sm,
    marginRight: Space.lg,
    paddingTop: Space.sm,
    paddingBottom: Space.lg,
    gap: Space.sm,
  },
  detail: { ...Type.callout, color: Color.secondaryText },
});
