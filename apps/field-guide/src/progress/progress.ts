import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GuideId } from '../catalog/catalog';
import type { ProcedureId } from '../domain/pack';

/** Where the viewer last was, so the library can offer to continue. */
export interface Progress {
  readonly guideId: GuideId;
  readonly procedureId: ProcedureId;
  readonly stepIndex: number;
}

const PROGRESS_KEY = 'field-guide/progress/v1';

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

export async function loadProgress(): Promise<Progress | null> {
  return parseProgress(await AsyncStorage.getItem(PROGRESS_KEY));
}

export async function saveProgress(progress: Progress): Promise<void> {
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

/** A finished or stopped procedure leaves nothing to continue. */
export async function clearProgress(): Promise<void> {
  await AsyncStorage.removeItem(PROGRESS_KEY);
}
