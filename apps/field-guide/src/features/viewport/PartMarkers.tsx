import { useCallback } from 'react';
import { StyleSheet, Text, type LayoutChangeEvent } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import type { PartId } from '../pack/pack';
import { Color, Font, Motion, Radius, Space, Type } from '../../ui/theme';
import {
  boxAt,
  type MarkedPart,
  type ProjectedParts,
  type Size,
} from './projectedParts';

const THICKNESS = 2;
const TAG_GAP = Space.xs;

interface Props {
  parts: readonly MarkedPart[];
  projection: ProjectedParts;
  /** A part labelled by its own card instead of a tag. */
  carded: PartId | null;
  /** Milliseconds to hold the marks back, while the capture is still sweeping in. */
  enterAfter: number;
}

export function PartMarkers({ parts, projection, carded, enterAfter }: Props) {
  return (
    <Animated.View
      entering={FadeIn.duration(Motion.base).delay(enterAfter)}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    >
      {parts.map((part, index) =>
        part.id === carded ? null : (
          <Marker
            key={part.id}
            index={index}
            name={part.name}
            projection={projection}
          />
        ),
      )}
    </Animated.View>
  );
}

interface MarkerProps {
  index: number;
  name: string;
  projection: ProjectedParts;
}

function Marker({ index, name, projection: { boxes, viewport } }: MarkerProps) {
  const tag = useSharedValue<Size>({ width: 0, height: 0 });
  const onTagLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      tag.value = { width, height };
    },
    [tag],
  );
  const tagStyle = useAnimatedStyle(() => {
    const box = boxAt(boxes.value, index);
    if (box === null || tag.value.width === 0) {
      return { opacity: 0 };
    }
    const above = box.top - TAG_GAP - tag.value.height;
    const below = box.bottom + TAG_GAP;
    const y =
      above >= 0
        ? above
        : below + tag.value.height <= viewport.value.height
        ? below
        : box.top + TAG_GAP;
    const x = Math.min(box.left, viewport.value.width - tag.value.width);
    return {
      opacity: 1,
      transform: [{ translateX: Math.max(0, x) }, { translateY: y }],
    };
  });
  return (
    <Animated.View
      onLayout={onTagLayout}
      style={[styles.tag, tagStyle]}
      accessible
      accessibilityLabel={`${name}, highlighted`}
      testID={`marker-${index}`}
    >
      <Text numberOfLines={1} style={styles.tagName}>
        {name}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tag: {
    position: 'absolute',
    left: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderLeftWidth: THICKNESS,
    borderLeftColor: Color.accent,
    borderTopRightRadius: Radius.sm,
    borderBottomRightRadius: Radius.sm,
    backgroundColor: Color.overlay,
  },
  tagName: { ...Type.footnote, fontFamily: Font.semiBold, color: Color.text },
});
