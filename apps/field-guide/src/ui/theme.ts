import type { TextStyle } from 'react-native';

// OLED black: a black pixel is off. Surfaces stay near black and neutral, and the one accent is
// the tint the renderer paints selected parts with (Highlight::kTint in the engine), so it only
// ever means "this one". The accent reads at 4.5:1 on black and under white text alike.
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
  accent: '#0A6CFF',
  accentPressed: '#0058D6',
  accentText: '#FFFFFF',
  accentWash: 'rgba(10, 108, 255, 0.16)',
  completed: 'rgba(10, 108, 255, 0.6)',
  // The primary action is white on black, like an instrument's, so the accent only ever
  // marks what is selected.
  action: '#F4F6F8',
  actionPressed: '#C3C9D0',
  actionText: '#000000',
  caution: '#F5B731',
  cautionWash: 'rgba(245, 183, 49, 0.10)',
  // Controls that float over the splat: dark enough to read on a bright capture.
  overlay: 'rgba(8, 9, 11, 0.78)',
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

// Plain, nearly square corners: controls 2, cards 4, sheets 12.
export const Radius = { sm: 2, md: 4, lg: 6, sheet: 12 } as const;

export const MIN_TOUCH = 44;
export const BUTTON_HEIGHT = 50;
export const HAIRLINE = 1;

export const Motion = {
  fast: 120,
  base: 220,
  slow: 320,
  scanPeriod: 1600,
  // A loaded capture sweeping in from the bottom up, as a scanner would read it.
  reveal: 1400,
  levelSmoothing: 80,
  wordAttack: 30,
  wordDecay: 180,
  spring: { mass: 1, damping: 30, stiffness: 280, overshootClamping: true },
} as const;

// Geist, the open (OFL) face closest to TT Interphases, Schemata's typeface. Bundled in
// ios/FieldGuide (UIAppFonts), see assets/fonts. Each weight is named by its PostScript name, so
// no style needs fontWeight to find it.
export const Font = {
  regular: 'Geist-Regular',
  semiBold: 'Geist-SemiBold',
  bold: 'Geist-Bold',
} as const;

// iOS text style sizes (Body 17), in sentence case throughout: plain type, bold headings, and
// figures of equal width wherever numbers sit in a column.
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
