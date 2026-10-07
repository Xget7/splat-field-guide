import type { TextStyle } from 'react-native';

// Match the renderer's selection tint (Highlight::kTint) so the accent consistently identifies selection.
export const Color = {
  black: '#000000',
  surface: '#0B0C0E',
  raised: '#15171A',
  pressed: '#1F2226',
  line: 'rgba(255, 255, 255, 0.10)',
  lineStrong: 'rgba(255, 255, 255, 0.22)',
  text: '#E9EDF1',
  secondaryText: '#B4BBC3',
  muted: '#8B939C',
  // 4.5:1 on black, so even the quietest readout passes AA.
  faint: '#767E88',
  // Text, icons and lines on dark surfaces.
  accent: '#2BB8CC',
  // Filled controls that carry white text.
  accentFill: '#0F7C8A',
  accentPressed: '#0B6874',
  accentText: '#FFFFFF',
  accentWash: 'rgba(43, 184, 204, 0.16)',
  completed: 'rgba(15, 124, 138, 0.75)',
  // Reserve the accent for selection by using a neutral primary action.
  action: '#F4F6F8',
  actionPressed: '#C3C9D0',
  actionText: '#000000',
  caution: '#F5B731',
  cautionWash: 'rgba(245, 183, 49, 0.10)',
  // Keep overlaid controls legible on bright captures.
  overlay: 'rgba(8, 9, 11, 0.78)',
  // The viewer's side column: the rail, then the drawer beside it.
  rail: '#0E1013',
  drawer: '#16181C',
  field: 'rgba(255, 255, 255, 0.06)',
  // Tints over a native blur; the strong one carries reading text.
  glass: 'rgba(20, 22, 26, 0.2)',
  glassStrong: 'rgba(20, 22, 26, 0.4)',
  glassLine: 'rgba(255, 255, 255, 0.14)',
} as const;

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
  sm: 2,
  md: 4,
  lg: 6,
  field: 10,
  control: 12,
  sheet: 12,
  card: 16,
  round: 999,
} as const;

// The blur library scales the system effect by this percentage; anything less reads as a flat tint.
export const BLUR_AMOUNT = 100;

export const MIN_TOUCH = 44;
export const BUTTON_HEIGHT = 50;
export const HAIRLINE = 1;

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
