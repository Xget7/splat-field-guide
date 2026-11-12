import type { HighlightLook } from 'react-native-splat';
import type { Part } from '../../pack/pack';

// The rest of the scene steps back only slightly, so the surroundings stay readable around the part.
export const HIGHLIGHT_OTHER_BRIGHTNESS = 0.85;
// The tint keeps 70 % of the captured colour, so the part's surface detail reads through it.
export const HIGHLIGHT_TINT_AMOUNT = 0.3;
// A small lift lets the part read as foreground even where its tint is close to its surroundings.
export const HIGHLIGHT_PART_BRIGHTNESS = 1.2;
// Parts from packs without a measured colour keep the earlier light navy.
export const HIGHLIGHT_FALLBACK_TINT = 0x2a5bd7;

const NO_DIM = 1;
const HALF_TURN_DEGREES = 180;
const FULL_TURN_DEGREES = 360;
const CHANNEL_MAX = 255;
const HEX_RADIX = 16;
// Below this saturation a hue is mostly sensor noise, as on black motors or grey pedestals,
// so its opposite would be arbitrary; lightness decides the tint instead.
const NEUTRAL_SATURATION = 0.2;
// Neutral parts take the fallback navy's hue, so every tint stays in one family.
const NEUTRAL_HUE_DEGREES = 223;
const MID_LIGHTNESS = 0.5;
// Moving a dark part toward a light tint brightens it; a light part needs a deep tint to show at all.
const LIGHT_TINT = { saturation: 0.9, lightness: 0.72 };
const DEEP_TINT = { saturation: 0.85, lightness: 0.35 };
// Opposite hues are strong and mid-light so a gentle tint amount still shifts the captured colour.
const OPPOSITE_TINT = { saturation: 0.85, lightness: 0.55 };

interface Hsl {
  hue: number;
  saturation: number;
  lightness: number;
}

/**
 * How the renderer marks the lead part of the highlight, the selected part or else the step's first;
 * null means nothing is highlighted, so the scene stays as captured.
 */
export function highlightLookFor(
  lead: Pick<Part, 'color'> | null,
): HighlightLook {
  return {
    tintRgb:
      lead?.color === undefined
        ? HIGHLIGHT_FALLBACK_TINT
        : contrastingTint(lead.color),
    tintAmount: HIGHLIGHT_TINT_AMOUNT,
    partBrightness: HIGHLIGHT_PART_BRIGHTNESS,
    otherBrightness: lead === null ? NO_DIM : HIGHLIGHT_OTHER_BRIGHTNESS,
  };
}

function contrastingTint(color: string): number {
  const part = hexToHsl(color);
  if (part.saturation < NEUTRAL_SATURATION) {
    const tint = part.lightness < MID_LIGHTNESS ? LIGHT_TINT : DEEP_TINT;
    return hslToRgb({ hue: NEUTRAL_HUE_DEGREES, ...tint });
  }
  return hslToRgb({
    hue: (part.hue + HALF_TURN_DEGREES) % FULL_TURN_DEGREES,
    ...OPPOSITE_TINT,
  });
}

/** `#rrggbb` as its three 0-255 channels. */
function hexChannels(color: string): [number, number, number] {
  return [1, 3, 5].map(start =>
    parseInt(color.slice(start, start + 2), HEX_RADIX),
  ) as [number, number, number];
}

function hexToHsl(color: string): Hsl {
  const [r, g, b] = hexChannels(color).map(level => level / CHANNEL_MAX);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  if (chroma === 0) {
    return { hue: 0, saturation: 0, lightness };
  }
  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  const sector =
    max === r
      ? ((g - b) / chroma + 6) % 6
      : max === g
      ? (b - r) / chroma + 2
      : (r - g) / chroma + 4;
  return { hue: sector * 60, saturation, lightness };
}

function hslToRgb({ hue, saturation, lightness }: Hsl): number {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const level =
      lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(level * CHANNEL_MAX);
  };
  return parseInt(
    [channel(0), channel(8), channel(4)]
      .map(level => level.toString(HEX_RADIX).padStart(2, '0'))
      .join(''),
    HEX_RADIX,
  );
}
