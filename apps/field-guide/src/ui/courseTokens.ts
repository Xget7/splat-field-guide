/** Course surfaces use the approved neutral palette; viewer emphasis has its own GPU contract. */
export const CourseColor = {
  canvas: '#141516',
  surface: '#1a1b1b',
  raised: '#242526',
  border: '#383a3c',
  text: '#e9eaec',
  secondary: '#a3a6ad',
  accent: '#ffd60a',
  white: '#ffffff',
  overlay: 'rgba(20,21,22,0.64)',
} as const;
export const Grid = {
  unit: 8,
  small: 16,
  medium: 24,
  large: 32,
  control: 48,
  sidebar: 176,
} as const;
export const CourseRadius = { control: 16, card: 24, pill: 999 } as const;
export const CourseType = {
  title: { fontSize: 32, lineHeight: 40, fontWeight: '600' as const },
  heading: { fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 24 },
  label: { fontSize: 13, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 12, lineHeight: 16 },
} as const;
