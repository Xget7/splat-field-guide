export const ALIAS_RULE_TYPE = 'alias';
export interface PronunciationRule {
  readonly type: string;
  readonly string_to_replace: string;
  readonly alias?: string;
  readonly case_sensitive?: boolean;
  readonly word_boundaries?: boolean;
}

export const pronunciationRules = [
  { type: ALIAS_RULE_TYPE, string_to_replace: 'Nm', alias: 'newton meters' },
  { type: ALIAS_RULE_TYPE, string_to_replace: 'psi', alias: 'P S I' },
  { type: ALIAS_RULE_TYPE, string_to_replace: '°C', alias: 'degrees Celsius' },
  { type: ALIAS_RULE_TYPE, string_to_replace: 'mm', alias: 'millimeters' },
  { type: ALIAS_RULE_TYPE, string_to_replace: 'MIN', alias: 'minimum' },
  { type: ALIAS_RULE_TYPE, string_to_replace: 'MAX', alias: 'maximum' },
] as const satisfies readonly PronunciationRule[];
