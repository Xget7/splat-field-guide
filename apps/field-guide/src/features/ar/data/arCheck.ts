import { Platform } from 'react-native';

// AR checks require the author's physical engine bay, so shared builds hide them by default.
export const AR_CHECK_ENABLED = false;

export function offersArCheck(): boolean {
  return AR_CHECK_ENABLED && Platform.OS === 'ios';
}
