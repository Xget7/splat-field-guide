import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createProgressStorage,
  type ProgressStorage,
} from '../../features/guide';

/**
 * Builds the app's one progress storage over the device's key-value storage, so every
 * screen shares its ordered writes.
 */
export function createAppProgress(): ProgressStorage {
  return createProgressStorage(AsyncStorage);
}
