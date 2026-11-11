import { CourseColor } from './courseTokens';
import type { TextStyle } from 'react-native';

// Interface emphasis uses the course primary; the renderer retains its independent part-selection tint.
export const Color = {
  // The camera and the splat stage only; every other surface is graphite.
  black: '#000000',
  // Graphite: screens deepen from the top colour to the surface, and cards sit a step above.
  canvasTop: CourseColor.surface,
  surface: CourseColor.canvas,
  raised: CourseColor.raised,
  pressed: '#303234',
  line: 'rgba(255, 255, 255, 0.10)',
  lineStrong: 'rgba(255, 255, 255, 0.22)',
  text: CourseColor.text,
  secondaryText: CourseColor.secondary,
  muted: '#9599a1',
  // 4.5:1 on raised surfaces, so even the quietest readout passes AA.
  faint: '#9599a1',
  // The course primary: about 14:1 on graphite, reserved for the current item and the way forward.
  accent: CourseColor.accent,
  // Filled controls carry black ink, about 15:1 on the primary.
  accentFill: CourseColor.accent,
  accentPressed: '#D9B500',
  accentText: '#000000',
  accentWash: 'rgba(255, 214, 10, 0.12)',
  completed: 'rgba(255, 255, 255, 0.16)',
  action: CourseColor.accent,
  actionPressed: '#D9B500',
  actionText: '#000000',
  // Orange keeps warnings distinct from the yellow primary.
  caution: '#FF8A3D',
  cautionWash: 'rgba(255, 138, 61, 0.10)',
  // Keep overlaid controls legible on bright captures.
  overlay: 'rgba(16, 17, 20, 0.78)',
  // The viewer's side column: the rail, then the drawer beside it.
  rail: CourseColor.canvas,
  drawer: CourseColor.surface,
  field: 'rgba(255, 255, 255, 0.06)',
  // Tints over a native blur; the strong one carries reading text.
  glass: 'rgba(20, 22, 26, 0.2)',
  glassStrong: 'rgba(20, 22, 26, 0.4)',
  glassLine: 'rgba(255, 255, 255, 0.14)',
  // Text over photos: a translucent surface behind small labels.
  chip: 'rgba(13, 14, 16, 0.62)',
} as const;

// A light-to-deep edge on the primary action, within the primary's hue.
export const Sheen = ['#FFF3A6', '#FFD60A', '#B89400'] as const;

export const Space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 6,
  md: 10,
  field: 10,
  control: 12,
  sheet: 12,
  card: 16,
  // The library's framed cards and banners.
  frame: 22,
  round: 999,
} as const;

// The blur library scales the system effect by this percentage; anything less reads as a flat tint.
export const BLUR_AMOUNT = 100;

export const MIN_TOUCH = 44;
export const BUTTON_HEIGHT = 50;
export const HAIRLINE = 1;

export const MODE_RULE_WIDTH = 2;
/** The drawer footer, the tool row and the collapsed assistant centre on one band this tall. */
export const BOTTOM_BAND_HEIGHT = 64;

export const Motion = {
  fast: 120,
  base: 220,
  slow: 320,
  scanPeriod: 1600,
  reveal: 1400,
  levelSmoothing: 80,
  wordAttack: 30,
  wordDecay: 180,
  spring: { mass: 1, damping: 30, stiffness: 280, overshootClamping: true },
} as const;

// Geist weights use PostScript names so styles do not need fontWeight.
export const Font = {
  regular: 'Geist-Regular',
  semiBold: 'Geist-SemiBold',
  bold: 'Geist-Bold',
} as const;

export const Type = {
  // The library's headline, phone then tablet.
  display: {
    fontFamily: Font.bold,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1,
  },
  displayWide: {
    fontFamily: Font.bold,
    fontSize: 56,
    lineHeight: 60,
    letterSpacing: -1.6,
  },
  largeTitle: {
    fontFamily: Font.bold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: Font.semiBold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.3,
  },
  headline: { fontFamily: Font.semiBold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: Font.regular, fontSize: 17, lineHeight: 24 },
  callout: { fontFamily: Font.regular, fontSize: 15, lineHeight: 20 },
  calloutStrong: { fontFamily: Font.semiBold, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: Font.regular, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: Font.semiBold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: Font.regular, fontSize: 12, lineHeight: 16 },
  data: {
    fontFamily: Font.regular,
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  dataLarge: {
    fontFamily: Font.semiBold,
    fontSize: 20,
    lineHeight: 24,
    fontVariant: ['tabular-nums'],
  },
} as const satisfies Record<string, TextStyle>;
