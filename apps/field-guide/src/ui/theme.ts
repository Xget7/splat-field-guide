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

// Bundled in ios/FieldGuide (UIAppFonts); OFL, see assets/fonts.
export const Font = {
  mono: 'JetBrainsMono-Medium',
  monoStrong: 'JetBrainsMono-SemiBold',
  monoBold: 'JetBrainsMono-Bold',
} as const;

// iOS text styles (Body 17), plus monospaced labels and readouts for the instrument look.
export const Type = {
  largeTitle: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 24 },
  callout: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  label: {
    fontFamily: Font.monoStrong,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  data: { fontFamily: Font.mono, fontSize: 13, lineHeight: 16 },
  dataLarge: {
    fontFamily: Font.monoStrong,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
} as const satisfies Record<string, TextStyle>;
