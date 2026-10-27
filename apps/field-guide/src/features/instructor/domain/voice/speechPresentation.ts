import { parseAnswer } from '../answerFormat';

/** Speech uses the same words and item boundaries as the thread, without list markers. */
export function speechTextFor(reply: string): string {
  return parseAnswer(reply).speech;
}

export const SpokenSection = { reply: 'reply', caution: 'caution' } as const;
export type SpokenSection = (typeof SpokenSection)[keyof typeof SpokenSection];

export interface WordRange {
  readonly location: number;
  readonly length: number;
}

export interface SpokenWord extends WordRange {
  readonly section: SpokenSection;
}

export const Meter = {
  width: 2,
  gap: 2,
  minHeight: 4,
  maxHeight: 14,
  radius: 0,
  weights: [0.45, 0.75, 1, 0.75, 0.45],
  minWordLevel: 0.25,
  fullWordLength: 10,
} as const;

export function normalizedLevel(level: number): number {
  'worklet';
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

export function meterHeightsFor(level: number): number[] {
  'worklet';
  const strength = normalizedLevel(level);
  return Meter.weights.map(
    weight =>
      Meter.minHeight + strength * weight * (Meter.maxHeight - Meter.minHeight),
  );
}

export function wordLevelFor(length: number): number {
  if (!Number.isFinite(length) || length <= 0) {
    return 0;
  }
  return Math.max(
    Meter.minWordLevel,
    normalizedLevel(length / Meter.fullWordLength),
  );
}
