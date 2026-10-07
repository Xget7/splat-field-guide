export const pronunciationRules = [
  { type: 'alias', string_to_replace: 'Gol', alias: 'goal' },
  { type: 'alias', string_to_replace: 'VW', alias: 'V W' },
  { type: 'alias', string_to_replace: 'Nm', alias: 'newton meters' },
  { type: 'alias', string_to_replace: 'psi', alias: 'P S I' },
  { type: 'alias', string_to_replace: '°C', alias: 'degrees Celsius' },
  { type: 'alias', string_to_replace: 'mm', alias: 'millimeters' },
  { type: 'alias', string_to_replace: 'MIN', alias: 'minimum' },
  { type: 'alias', string_to_replace: 'MAX', alias: 'maximum' },
  { type: 'alias', string_to_replace: 'VIN', alias: 'V I N' },
  { type: 'alias', string_to_replace: 'EA111', alias: 'E A one one one' },
  { type: 'alias', string_to_replace: '5W-40', alias: 'five W forty' },
] as const;
export type PronunciationRule = (typeof pronunciationRules)[number];
