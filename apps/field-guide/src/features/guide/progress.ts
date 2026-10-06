import type { GuideId } from '../pack/catalog';
import type { ProcedureId } from '../pack/pack';

export interface Progress {
  readonly guideId: GuideId;
  readonly procedureId: ProcedureId;
  readonly stepIndex: number;
}

/** Anything but a well formed record reads as no progress. */
export function parseProgress(raw: string | null): Progress | null {
  if (raw === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const { guideId, procedureId, stepIndex } = value as Record<
      string,
      unknown
    >;
    if (
      typeof guideId !== 'string' ||
      typeof procedureId !== 'string' ||
      typeof stepIndex !== 'number' ||
      !Number.isInteger(stepIndex) ||
      stepIndex < 0
    ) {
      return null;
    }
    return { guideId, procedureId, stepIndex };
  } catch {
    return null;
  }
}
