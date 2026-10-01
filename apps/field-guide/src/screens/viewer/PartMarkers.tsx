import { useCallback, useEffect } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import type { SplatViewSpec } from 'react-native-splat';
import type { Bounds, PartId } from '../../domain/pack';
import { Label } from '../../ui/kit';
import { Color, Radius, Space } from '../../ui/theme';

export interface MarkedPart {
  readonly id: PartId;
  readonly name: string;
  readonly bounds: Bounds;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

const CORNERS_PER_BOX = 8;
const FLOATS_PER_POINT = 3;
const FLOATS_PER_SCREEN_POINT = 2;
// Per box in `boxes`: left, top, right, bottom in points, then 1 when it shows.
const FLOATS_PER_BOX = 5;
const BOX_PADDING = Space.sm;
// Smaller than this and the four corners would run into each other.
const MIN_BOX = 32;
const ARM = 12;
const THICKNESS = 2;
// Moves below half a point are invisible; skipping them keeps a still camera free.
const SETTLE_POINTS = 0.5;
const TAG_GAP = Space.xs;

const Corner = {
  topLeft: 'topLeft',
  topRight: 'topRight',
  bottomLeft: 'bottomLeft',
  bottomRight: 'bottomRight',
} as const;
type Corner = (typeof Corner)[keyof typeof Corner];
const CORNERS: readonly Corner[] = Object.values(Corner);

/** The eight corners of each box, as float32 x, y, z triples. */
function cornersOf(parts: readonly MarkedPart[]): number[] {
  return parts.flatMap(({ bounds: { min, max } }) =>
    [min[0], max[0]].flatMap(x =>
      [min[1], max[1]].flatMap(y => [min[2], max[2]].flatMap(z => [x, y, z])),
    ),
  );
}

interface Props {
  view: SplatViewSpec | null;
  parts: readonly MarkedPart[];
  size: Size;
}

/**
 * Brackets and a name tag around each part, following the camera every frame. The corners
 * are projected on the UI thread, where the renderer's last frame is read synchronously, so
 * the marks track an orbit without a React render per frame.
 */
export function PartMarkers({ view, parts, size }: Props) {
  const corners = useSharedValue<number[]>([]);
  const viewport = useSharedValue<Size>(size);
  const boxes = useSharedValue<number[]>([]);

  useEffect(() => {
    corners.value = cornersOf(parts);
  }, [corners, parts]);
  useEffect(() => {
    viewport.value = size;
  }, [viewport, size]);

  const track = useCallback(() => {
    'worklet';
    const points = corners.value;
    const pointCount = points.length / FLOATS_PER_POINT;
    const { width, height } = viewport.value;
    if (view === null || pointCount === 0 || width === 0 || height === 0) {
      if (boxes.value.length > 0) {
        boxes.value = [];
      }
      return;
    }
    const projected = new Float32Array(pointCount * FLOATS_PER_SCREEN_POINT);
    view.project(new Float32Array(points).buffer, projected.buffer);
    const next: number[] = [];
    for (let box = 0; box < pointCount / CORNERS_PER_BOX; box++) {
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      let inFront = true;
      for (let corner = 0; corner < CORNERS_PER_BOX; corner++) {
        const at = (box * CORNERS_PER_BOX + corner) * FLOATS_PER_SCREEN_POINT;
        const x = projected[at] * width;
        const y = projected[at + 1] * height;
        // A corner behind the camera has no place on screen, so neither has the box.
        if (Number.isNaN(x) || Number.isNaN(y)) {
          inFront = false;
          break;
        }
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
      const centreX = (left + right) / 2;
      const centreY = (top + bottom) / 2;
      const halfWidth = Math.max(MIN_BOX, right - left + 2 * BOX_PADDING) / 2;
      const halfHeight = Math.max(MIN_BOX, bottom - top + 2 * BOX_PADDING) / 2;
      const shown =
        inFront &&
        centreX + halfWidth > 0 &&
        centreX - halfWidth < width &&
        centreY + halfHeight > 0 &&
        centreY - halfHeight < height;
      if (shown) {
        next.push(
          Math.max(0, centreX - halfWidth),
          Math.max(0, centreY - halfHeight),
          Math.min(width, centreX + halfWidth),
          Math.min(height, centreY + halfHeight),
          1,
        );
      } else {
        next.push(0, 0, 0, 0, 0);
      }
    }
    const previous = boxes.value;
    const moved =
      previous.length !== next.length ||
      next.some((value, i) => Math.abs(value - previous[i]) >= SETTLE_POINTS);
    if (moved) {
      boxes.value = next;
    }
  }, [view, corners, viewport, boxes]);
  useFrameCallback(track);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {parts.map((part, index) => (
        <Marker
          key={part.id}
          index={index}
          name={part.name}
          boxes={boxes}
          viewport={viewport}
        />
      ))}
    </View>
  );
}

interface MarkerProps {
  index: number;
  name: string;
  boxes: SharedValue<number[]>;
  viewport: SharedValue<Size>;
}

function Marker({ index, name, boxes, viewport }: MarkerProps) {
  const tag = useSharedValue<Size>({ width: 0, height: 0 });
  const onTagLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      tag.value = { width, height };
    },
    [tag],
  );
  const tagStyle = useAnimatedStyle(() => {
    const at = index * FLOATS_PER_BOX;
    const box = boxes.value;
    if (box.length <= at || box[at + 4] === 0 || tag.value.width === 0) {
      return { opacity: 0 };
    }
    const [left, top, , bottom] = box.slice(at, at + 4);
    const above = top - TAG_GAP - tag.value.height;
    const below = bottom + TAG_GAP;
    // Above the box, else below it, else inside its top edge.
    const y =
      above >= 0
        ? above
        : below + tag.value.height <= viewport.value.height
        ? below
        : top + TAG_GAP;
    const x = Math.min(left, viewport.value.width - tag.value.width);
    return {
      opacity: 1,
      transform: [{ translateX: Math.max(0, x) }, { translateY: y }],
    };
  });
  return (
    <>
      {CORNERS.map(corner => (
        <MarkerCorner
          key={corner}
          corner={corner}
          index={index}
          boxes={boxes}
        />
      ))}
      <Animated.View
        onLayout={onTagLayout}
        style={[styles.tag, tagStyle]}
        accessible
        accessibilityLabel={`${name}, highlighted`}
        testID={`marker-${index}`}
      >
        <Label color={Color.accent} numberOfLines={1}>
          {name}
        </Label>
      </Animated.View>
    </>
  );
}

const CORNER_STYLE: Readonly<Record<Corner, object>> = {
  topLeft: { borderTopWidth: THICKNESS, borderLeftWidth: THICKNESS },
  topRight: { borderTopWidth: THICKNESS, borderRightWidth: THICKNESS },
  bottomLeft: { borderBottomWidth: THICKNESS, borderLeftWidth: THICKNESS },
  bottomRight: { borderBottomWidth: THICKNESS, borderRightWidth: THICKNESS },
};

function MarkerCorner({
  corner,
  index,
  boxes,
}: {
  corner: Corner;
  index: number;
  boxes: SharedValue<number[]>;
}) {
  const style = useAnimatedStyle(() => {
    const at = index * FLOATS_PER_BOX;
    const box = boxes.value;
    if (box.length <= at || box[at + 4] === 0) {
      return { opacity: 0 };
    }
    const right = corner === Corner.topRight || corner === Corner.bottomRight;
    const bottom =
      corner === Corner.bottomLeft || corner === Corner.bottomRight;
    return {
      opacity: 1,
      transform: [
        { translateX: right ? box[at + 2] - ARM : box[at] },
        { translateY: bottom ? box[at + 3] - ARM : box[at + 1] },
      ],
    };
  });
  return <Animated.View style={[styles.corner, CORNER_STYLE[corner], style]} />;
}

const styles = StyleSheet.create({
  corner: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: ARM,
    height: ARM,
    borderColor: Color.accent,
  },
  tag: {
    position: 'absolute',
    left: 0,
    top: 0,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.sm,
    backgroundColor: Color.overlay,
  },
});
