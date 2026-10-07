import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Part } from '../../../features/pack/pack';
import {
  boxAt,
  useProjection,
  type ScreenBox,
  type Size,
} from '../../../features/viewport/projectedParts';
import { Glass, GlassTone } from '../../../ui/Glass';
import { Icon, IconName } from '../../../ui/Icon';
import {
  Color,
  Font,
  MIN_TOUCH,
  Motion,
  Radius,
  Space,
  Type,
} from '../../../ui/theme';
import { placeOn, sideFor, type Clearance, type Side } from './cardPlacement';

const CARD_WIDTH = 420;
const GAP = Space.sm;
const ICON_SIZE = 24;
const ENTER_SCALE = 0.98;
const CardCopy = {
  fold: 'Fold part card',
  unfold: 'Expand part card',
  foldHint: 'Hide the part summary',
  unfoldHint: 'Show the part summary',
} as const;
const FADE_IN = FadeIn.duration(Motion.base).reduceMotion(ReduceMotion.Never);
const FADE_OUT = FadeOut.duration(Motion.base).reduceMotion(ReduceMotion.Never);

function enter() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: ENTER_SCALE }] },
    animations: {
      opacity: withTiming(1, { duration: Motion.base }),
      transform: [{ scale: withTiming(1, { duration: Motion.base }) }],
    },
  };
}

function exit() {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: Motion.base }),
      transform: [
        { scale: withTiming(ENTER_SCALE, { duration: Motion.base }) },
      ],
    },
  };
}

interface Props {
  part: Part | null;
  stage: Size;
  clear: Clearance;
}

/** The part in focus, named and summarised beside it on the model. */
export function PartCard({ part, stage, clear }: Props) {
  const [folded, setFolded] = useState(false);
  if (part === null || stage.width === 0) {
    return null;
  }
  return (
    <PlacedCard
      key={part.id}
      part={part}
      stage={stage}
      clear={clear}
      folded={folded}
      onFold={() => setFolded(value => !value)}
    />
  );
}

interface PlacedProps extends Props {
  part: Part;
  folded: boolean;
  onFold: () => void;
}

function PlacedCard({ part, stage, clear, folded, onFold }: PlacedProps) {
  const reducedMotion = useReducedMotion();
  const projection = useProjection();
  const index = projection?.ids.indexOf(part.id) ?? -1;
  const width = Math.max(
    0,
    Math.min(CARD_WIDTH, stage.width - clear.left - clear.right),
  );
  const maxHeight = Math.max(0, stage.height - clear.top - clear.bottom);
  const [shown, setShown] = useState(false);
  const clearance = useSharedValue<Clearance>(clear);
  const card = useSharedValue<Size>({ width, height: 0 });
  const anchor = useSharedValue<{ box: ScreenBox; area: ScreenBox } | null>(
    null,
  );
  const side = useSharedValue<Side | null>(null);
  const from = useSharedValue<Side | null>(null);
  const blend = useSharedValue(1);
  const visibility = useSharedValue(0);
  const { top, right, bottom, left } = clear;

  useEffect(() => {
    clearance.value = { top, right, bottom, left };
  }, [clearance, top, right, bottom, left]);
  useEffect(() => {
    card.value = { width, height: card.value.height };
  }, [card, width]);

  useAnimatedReaction(
    () => {
      const box =
        projection === null ? null : boxAt(projection.boxes.value, index);
      return box === null || projection === null || card.value.height === 0
        ? null
        : { box, area: areaWithin(projection.viewport.value, clearance.value) };
    },
    placed => {
      if (placed === null) {
        if (visibility.value > 0) {
          visibility.value = withTiming(0, { duration: Motion.base });
          scheduleOnRN(setShown, false);
        }
        return;
      }
      const next = sideFor(
        placed.box,
        card.value,
        placed.area,
        GAP,
        side.value,
      );
      anchor.value = placed;
      if (side.value === null) {
        side.value = next;
        from.value = next;
      } else if (next !== side.value) {
        from.value = side.value;
        side.value = next;
        blend.value = 0;
        blend.value = reducedMotion
          ? 1
          : withTiming(1, { duration: Motion.base });
      }
      if (visibility.value === 0) {
        visibility.value = withTiming(1, { duration: Motion.base });
        scheduleOnRN(setShown, true);
      }
    },
    [projection, index, reducedMotion],
  );

  const placement = useAnimatedStyle(() => {
    const placed = anchor.value;
    if (placed === null || side.value === null || from.value === null) {
      return {};
    }
    const { box, area } = placed;
    const target = placeOn(side.value, box, card.value, area, GAP);
    const start = placeOn(from.value, box, card.value, area, GAP);
    return {
      left: start.x + (target.x - start.x) * blend.value,
      top: start.y + (target.y - start.y) * blend.value,
    };
  });
  const fade = useAnimatedStyle(() => ({ opacity: visibility.value }));

  return (
    <Animated.View
      testID="stage-part-card"
      entering={reducedMotion ? FADE_IN : enter}
      exiting={reducedMotion ? FADE_OUT : exit}
      pointerEvents={shown ? 'box-none' : 'none'}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      onLayout={event => {
        card.value = { width, height: event.nativeEvent.layout.height };
      }}
      style={[styles.position, { width, maxHeight }, placement]}
    >
      <Animated.View style={fade}>
        <Glass
          tone={GlassTone.strong}
          radius={Radius.card}
          role="group"
          accessible={false}
          accessibilityLabel={part.name}
          style={{ maxHeight }}
        >
          <View style={[styles.header, !folded && styles.headerOpen]}>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              style={styles.title}
            >
              {part.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={folded ? CardCopy.unfold : CardCopy.fold}
              accessibilityHint={
                folded ? CardCopy.unfoldHint : CardCopy.foldHint
              }
              accessibilityState={{ expanded: !folded }}
              onPress={onFold}
              style={({ pressed }) => [styles.fold, pressed && styles.pressed]}
            >
              <Icon
                name={folded ? IconName.down : IconName.up}
                size={ICON_SIZE}
              />
            </Pressable>
          </View>
          {!folded && (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
            >
              <Text style={styles.summary}>{part.summary}</Text>
            </ScrollView>
          )}
        </Glass>
      </Animated.View>
    </Animated.View>
  );
}

function areaWithin(viewport: Size, clear: Clearance): ScreenBox {
  'worklet';
  return {
    left: clear.left,
    top: clear.top,
    right: viewport.width - clear.right,
    bottom: viewport.height - clear.bottom,
  };
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 0, top: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    paddingLeft: Space.xl,
    paddingRight: Space.md,
    paddingVertical: Space.md,
    gap: Space.sm,
  },
  // The summary sits close under the name; the touch target supplies the space.
  headerOpen: { paddingBottom: 0 },
  title: {
    ...Type.title,
    fontFamily: Font.bold,
    color: Color.text,
    flex: 1,
  },
  fold: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: Color.field },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.xs,
    paddingBottom: Space.xl,
  },
  summary: { ...Type.body, color: Color.text },
});
