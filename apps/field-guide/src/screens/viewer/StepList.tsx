import { useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { SectionHeader } from '../../ui/SectionHeader';
import { CautionNote } from './instructor/CautionNote';
import { Color, HAIRLINE, Radius, Space, Type } from '../../ui/theme';
import type { StepRow } from './guideContent';

const BADGE_SIZE = 28;
const TEXT_LINES = 2;

// Earlier steps may have been skipped, so they do not imply completion.
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
  upcoming: Color.secondaryText,
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
      style={[
        styles.badge,
        state === StepState.earlier && styles.badgeEarlier,
        state === StepState.current && styles.badgeCurrent,
      ]}
    >
      <Text
        style={[
          styles.number,
          state !== StepState.upcoming && styles.numberFilled,
        ]}
      >
        {index + 1}
      </Text>
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
  /** Expanded rows include the safety note because no other panel shows the full step. */
  expanded?: boolean;
}) {
  const scroll = useRef<ScrollViewInstance>(null);
  const tops = useRef<number[]>([]);
  const heights = useRef<number[]>([]);
  const offset = useRef(0);
  const visible = useRef(0);
  useEffect(() => {
    const top = tops.current[current];
    const height = heights.current[current];
    if (top === undefined || height === undefined) {
      return;
    }
    if (top < offset.current) {
      scroll.current?.scrollTo({ y: top, animated: true });
    } else if (top + height > offset.current + visible.current) {
      scroll.current?.scrollTo({
        y: top + height - visible.current,
        animated: true,
      });
    }
  }, [current]);

  return (
    <View testID="step-list" style={styles.list}>
      <SectionHeader title="Steps" style={styles.header} />
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={styles.rows}
        onLayout={event => {
          visible.current = event.nativeEvent.layout.height;
        }}
        onScroll={event => {
          offset.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        {rows.map((row, index) => {
          const state = stateOf(index, current);
          const whole = expanded && state === StepState.current;
          return (
            <Pressable
              key={row.id}
              testID={`step-row-${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Step ${index + 1} of ${rows.length}, ${
                SPOKEN_STATE[state]
              }: ${row.text}${whole ? ` ${row.detail}` : ''}${
                row.caution !== '' ? ', has a safety note' : ''
              }`}
              accessibilityState={{ selected: state === StepState.current }}
              onLayout={event => {
                tops.current[index] = event.nativeEvent.layout.y;
                heights.current[index] = event.nativeEvent.layout.height;
              }}
              onPress={() => onSelect(index)}
              style={({ pressed }) => [
                styles.row,
                state === StepState.current && styles.rowCurrent,
                whole && styles.rowWhole,
                pressed && styles.rowPressed,
              ]}
            >
              <Badge index={index} state={state} />
              <View style={[styles.words, whole && styles.wordsWhole]}>
                <Text
                  testID={whole ? 'step-current-text' : undefined}
                  numberOfLines={whole ? undefined : TEXT_LINES}
                  style={[styles.text, { color: TEXT_COLOR[state] }]}
                >
                  {row.text}
                </Text>
                {whole && row.detail !== '' && (
                  <Text testID="step-current-detail" style={styles.detail}>
                    {row.detail}
                  </Text>
                )}
                {whole && row.caution !== '' && (
                  <CautionNote text={row.caution} />
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flexShrink: 1, gap: Space.md, paddingTop: Space.lg },
  header: { paddingHorizontal: Space.lg },
  scroll: { flexGrow: 0, flexShrink: 1 },
  rows: { gap: Space.sm, paddingHorizontal: Space.lg, paddingBottom: Space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.line,
    backgroundColor: Color.surface,
  },
  rowCurrent: { borderColor: Color.accent, backgroundColor: Color.accentWash },
  rowPressed: { backgroundColor: Color.pressed },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
  },
  badgeEarlier: {
    backgroundColor: Color.completed,
    borderColor: Color.completed,
  },
  badgeCurrent: {
    backgroundColor: Color.accentFill,
    borderColor: Color.accentFill,
  },
  number: { ...Type.data, color: Color.faint },
  numberFilled: { color: Color.accentText },
  // Align the first line of wrapped text with the badge.
  rowWhole: { alignItems: 'flex-start' },
  words: { flex: 1, gap: Space.sm },
  wordsWhole: { paddingTop: (BADGE_SIZE - Type.callout.lineHeight) / 2 },
  text: Type.callout,
  detail: { ...Type.callout, color: Color.secondaryText },
});
