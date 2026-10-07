import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Part } from '../../../features/pack/pack';
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

const CARD_WIDTH = 360;
const HEADER_HEIGHT = MIN_TOUCH + Space.sm * 2;
const ICON_SIZE = 20;
const ENTER_SCALE = 0.98;
const PAN_DISTANCE = 4;
const DEFAULT_POSITION_ACTION = 'moveToDefaultPosition';
const CardCopy = {
  fold: 'Fold part card',
  unfold: 'Expand part card',
  foldHint: 'Hide the part summary',
  unfoldHint: 'Show the part summary',
  moveHint: 'Drag to move the card',
  reset: 'Move to default position',
} as const;
const ACTIONS = [{ name: DEFAULT_POSITION_ACTION, label: CardCopy.reset }];
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

function clamp(value: number, maximum: number) {
  'worklet';
  return Math.max(0, Math.min(value, Math.max(0, maximum)));
}

interface Props {
  part: Part | null;
  stage: { width: number; height: number };
  insetTop: number;
  insetRight: number;
}

export function PartCard({ part, stage, insetTop, insetRight }: Props) {
  const [folded, setFolded] = useState(false);
  const reducedMotion = useReducedMotion();
  const width = Math.min(CARD_WIDTH, Math.max(0, stage.width));
  const height = useSharedValue(HEADER_HEIGHT);
  const position = useSharedValue({
    x: clamp(stage.width - width - insetRight, stage.width - width),
    y: clamp(insetTop, stage.height - HEADER_HEIGHT),
  });
  const origin = useSharedValue({ x: 0, y: 0 });
  const moved = useSharedValue(false);
  const bounds = useSharedValue(stage);

  useEffect(() => {
    bounds.value = { width: stage.width, height: stage.height };
    position.value = moved.value
      ? {
          x: clamp(position.value.x, stage.width - width),
          y: clamp(position.value.y, stage.height - height.value),
        }
      : {
          x: clamp(stage.width - width - insetRight, stage.width - width),
          y: clamp(insetTop, stage.height - height.value),
        };
  }, [
    bounds,
    height,
    insetRight,
    insetTop,
    moved,
    position,
    stage.height,
    stage.width,
    width,
  ]);

  const resetPosition = useCallback(() => {
    moved.value = false;
    position.value = {
      x: clamp(stage.width - width - insetRight, stage.width - width),
      y: clamp(insetTop, stage.height - height.value),
    };
  }, [
    height,
    insetRight,
    insetTop,
    moved,
    position,
    stage.height,
    stage.width,
    width,
  ]);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      height.value = event.nativeEvent.layout.height;
      position.value = {
        x: clamp(position.value.x, bounds.value.width - width),
        y: clamp(position.value.y, bounds.value.height - height.value),
      };
    },
    [bounds, height, position, width],
  );
  const pan = usePanGesture({
    minDistance: PAN_DISTANCE,
    maxPointers: 1,
    onActivate: () => {
      'worklet';
      origin.value = position.value;
      moved.value = true;
    },
    onUpdate: event => {
      'worklet';
      position.value = {
        x: clamp(
          origin.value.x + event.translationX,
          bounds.value.width - width,
        ),
        y: clamp(
          origin.value.y + event.translationY,
          bounds.value.height - height.value,
        ),
      };
    },
  });
  const placement = useAnimatedStyle(() => ({
    left: position.value.x,
    top: position.value.y,
  }));
  const moveToDefault = (event: { nativeEvent: { actionName: string } }) => {
    if (event.nativeEvent.actionName === DEFAULT_POSITION_ACTION) {
      resetPosition();
    }
  };

  // Placing the card needs the stage's size, and a move made while it enters is lost.
  if (part === null || stage.width === 0) {
    return null;
  }

  return (
    <Animated.View
      testID="stage-part-card"
      entering={reducedMotion ? FADE_IN : enter}
      exiting={reducedMotion ? FADE_OUT : exit}
      onLayout={onLayout}
      style={[styles.position, { width, maxHeight: stage.height }, placement]}
    >
      <Glass
        tone={GlassTone.strong}
        radius={Radius.card}
        role="group"
        accessible={false}
        accessibilityLabel={part.name}
        accessibilityActions={ACTIONS}
        onAccessibilityAction={moveToDefault}
        style={{ maxHeight: stage.height }}
      >
        <View style={[styles.header, !folded && styles.headerOpen]}>
          <GestureDetector gesture={pan}>
            <View
              collapsable={false}
              accessible
              accessibilityRole="header"
              accessibilityLabel={part.name}
              accessibilityHint={CardCopy.moveHint}
              accessibilityActions={ACTIONS}
              onAccessibilityAction={moveToDefault}
              style={styles.handle}
            >
              <Icon name={IconName.grip} size={ICON_SIZE} color={Color.muted} />
              <Text accessible={false} numberOfLines={2} style={styles.title}>
                {part.name}
              </Text>
            </View>
          </GestureDetector>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={folded ? CardCopy.unfold : CardCopy.fold}
            accessibilityHint={folded ? CardCopy.unfoldHint : CardCopy.foldHint}
            accessibilityState={{ expanded: !folded }}
            onPress={() => setFolded(value => !value)}
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
  );
}

const styles = StyleSheet.create({
  position: { position: 'absolute' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    paddingLeft: Space.lg,
    paddingRight: Space.sm,
    paddingVertical: Space.sm,
    gap: Space.sm,
  },
  // The summary sits close under the name; the touch target supplies the space.
  headerOpen: { paddingBottom: 0 },
  handle: {
    flex: 1,
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  title: {
    ...Type.headline,
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
    paddingHorizontal: Space.lg,
    paddingTop: Space.xs,
    paddingBottom: Space.lg,
  },
  summary: { ...Type.body, color: Color.text },
});
