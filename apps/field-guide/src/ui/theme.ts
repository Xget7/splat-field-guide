import type { TextStyle } from 'react-native';

// OLED black: a black pixel is off. Surfaces stay near black and neutral, and the one accent is
// the tint the renderer paints selected parts with, so it only ever means "this one".
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
  faint: '#5A616A',
  accent: '#38BDF8',
  accentPressed: '#7DD3FC',
  accentText: '#00141D',
  accentWash: 'rgba(56, 189, 248, 0.12)',
  completed: 'rgba(56, 189, 248, 0.45)',
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

// Squared corners read as an instrument, not a toy.
export const Radius = { sm: 4, md: 8, lg: 12, sheet: 20 } as const;

export const MIN_TOUCH = 44;
export const BUTTON_HEIGHT = 50;
export const HAIRLINE = 1;

// Geist and Geist Mono, the open (OFL) faces closest to TT Interphases, Schemata's typeface.
// Bundled in ios/FieldGuide (UIAppFonts), see assets/fonts. Each weight is named by its
// PostScript name, so no style needs fontWeight to find it.
export const Font = {
  regular: 'Geist-Regular',
  semiBold: 'Geist-SemiBold',
  bold: 'Geist-Bold',
  mono: 'GeistMono-Medium',
  monoStrong: 'GeistMono-SemiBold',
} as const;

// iOS text style sizes (Body 17); readouts are monospaced so their digits line up.
export const Type = {
  largeTitle: {
    fontFamily: Font.bold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
  },
  title: {
    fontFamily: Font.bold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  headline: { fontFamily: Font.semiBold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: Font.regular, fontSize: 17, lineHeight: 24 },
  callout: { fontFamily: Font.regular, fontSize: 15, lineHeight: 20 },
  calloutStrong: { fontFamily: Font.semiBold, fontSize: 15, lineHeight: 20 },
  footnote: { fontFamily: Font.regular, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: Font.semiBold, fontSize: 13, lineHeight: 16 },
  data: { fontFamily: Font.mono, fontSize: 13, lineHeight: 16 },
  dataLarge: {
    fontFamily: Font.monoStrong,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
} as const satisfies Record<string, TextStyle>;
