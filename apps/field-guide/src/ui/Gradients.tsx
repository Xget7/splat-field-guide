import { useState, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, {
  Defs,
  Image,
  LinearGradient,
  Mask,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { Color, Sheen } from './theme';

const Glow = {
  // Centre and reach of the light behind the title, as fractions of the backdrop.
  x: 0.82,
  y: -0.08,
  reach: 0.7,
  opacity: 0.12,
} as const;

const Light = {
  // The centre of a spotlight, which fades out to its box's edges.
  opacity: 0.14,
} as const;

const Ring = {
  width: 1.5,
} as const;

const Fade = {
  // The scrim reaches half its strength at this point between start and bottom.
  midpoint: 0.5,
  midOpacity: 0.6,
} as const;

// A mask shows fully what lies under white.
const MASK_OPAQUE = '#FFFFFF';
// Points along a photo's fade; a smoothstep through them leaves no edge at either end.
const Ease = [0, 0.25, 0.5, 0.75, 1] as const;

interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Draws over its parent at the parent's measured size.
 * An Svg sized only by style keeps drawing at its first size after a rotation.
 */
export function SvgFill({ children }: { children: (size: Size) => ReactNode }) {
  const [size, setSize] = useState<Size | null>(null);
  const measure = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    setSize(current =>
      current?.width === layout.width && current.height === layout.height
        ? current
        : { width: layout.width, height: layout.height },
    );
  };
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={measure}
    >
      {size && (
        <Svg width={size.width} height={size.height}>
          {children(size)}
        </Svg>
      )}
    </View>
  );
}

/** The library's backdrop: graphite deepening downward, lit softly from the top. */
export function Backdrop() {
  return (
    <SvgFill>
      {({ width, height }) => (
        <>
          <Defs>
            <LinearGradient id="backdrop-depth" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={Color.canvasTop} />
              <Stop offset="1" stopColor={Color.surface} />
            </LinearGradient>
            <RadialGradient
              id="backdrop-glow"
              gradientUnits="userSpaceOnUse"
              cx={width * Glow.x}
              cy={height * Glow.y}
              r={Math.max(width, height) * Glow.reach}
            >
              <Stop
                offset="0"
                stopColor={Color.text}
                stopOpacity={Glow.opacity}
              />
              <Stop offset="1" stopColor={Color.text} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={width} height={height} fill="url(#backdrop-depth)" />
          <Rect width={width} height={height} fill="url(#backdrop-glow)" />
        </>
      )}
    </SvgFill>
  );
}

/** A soft light behind a 3D model, brightest at the centre of its box. */
export function Spotlight({ id }: { id: string }) {
  return (
    <SvgFill>
      {({ width, height }) => (
        <>
          <Defs>
            <RadialGradient id={id} cx="50%" cy="50%" r="50%">
              <Stop
                offset="0"
                stopColor={Color.text}
                stopOpacity={Light.opacity}
              />
              <Stop offset="1" stopColor={Color.text} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={width} height={height} fill={`url(#${id})`} />
        </>
      )}
    </SvgFill>
  );
}

/** Fades the lower part of a photo into the canvas so text over it stays legible. */
export function Scrim({
  id,
  start,
  opacity = 1,
}: {
  id: string;
  /** Where the fade begins, from the top, as a fraction of the height. */
  start: number;
  opacity?: number;
}) {
  const middle = start + (1 - start) * Fade.midpoint;
  return (
    <SvgFill>
      {({ width, height }) => (
        <>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset={start} stopColor={Color.surface} stopOpacity={0} />
              <Stop
                offset={middle}
                stopColor={Color.surface}
                stopOpacity={opacity * Fade.midOpacity}
              />
              <Stop
                offset="1"
                stopColor={Color.surface}
                stopOpacity={opacity}
              />
            </LinearGradient>
          </Defs>
          <Rect width={width} height={height} fill={`url(#${id})`} />
        </>
      )}
    </SvgFill>
  );
}

/**
 * A photo covering its parent that fades out toward the bottom, into whatever lies behind it.
 * Fading to a colour would seam against a lit backdrop, whose colour changes across the width.
 */
export function FadingPhoto({
  id,
  source,
  start,
}: {
  id: string;
  source: ImageSourcePropType;
  /** Where the fade begins, from the top, as a fraction of the height. */
  start: number;
}) {
  const alpha = `${id}-alpha`;
  return (
    <SvgFill>
      {({ width, height }) => (
        <>
          <Defs>
            <LinearGradient id={alpha} x1="0" y1="0" x2="0" y2="1">
              {Ease.map(step => (
                <Stop
                  key={step}
                  offset={start + (1 - start) * step}
                  stopColor={MASK_OPAQUE}
                  stopOpacity={1 - step * step * (3 - 2 * step)}
                />
              ))}
            </LinearGradient>
            <Mask
              id={id}
              maskUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={width}
              height={height}
            >
              <Rect width={width} height={height} fill={`url(#${alpha})`} />
            </Mask>
          </Defs>
          <Image
            width={width}
            height={height}
            href={source}
            preserveAspectRatio="xMidYMid slice"
            mask={`url(#${id})`}
          />
        </>
      )}
    </SvgFill>
  );
}

/** An iridescent ring along a rounded control's edge, drawn over it. */
export function SheenEdge({ id, radius }: { id: string; radius: number }) {
  return (
    <SvgFill>
      {({ width, height }) => {
        const inset = Ring.width / 2;
        // A pill's radius is half its height, however large the radius asked for.
        const corner = Math.min(radius, height / 2, width / 2) - inset;
        return (
          <>
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
                {Sheen.map((color, index) => (
                  <Stop
                    key={color}
                    offset={index / (Sheen.length - 1)}
                    stopColor={color}
                  />
                ))}
              </LinearGradient>
            </Defs>
            <Rect
              x={inset}
              y={inset}
              width={width - Ring.width}
              height={height - Ring.width}
              rx={corner}
              ry={corner}
              fill="none"
              stroke={`url(#${id})`}
              strokeWidth={Ring.width}
            />
          </>
        );
      }}
    </SvgFill>
  );
}
