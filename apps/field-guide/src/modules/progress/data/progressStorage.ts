import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseProgress, type Progress } from '../model/progress';

const PROGRESS_KEY = 'field-guide/progress/v1';

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
