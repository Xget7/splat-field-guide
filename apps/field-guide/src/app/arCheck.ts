import { Platform } from 'react-native';

// The AR check recognises the author's physical engine bay, which people trying
// a shared build cannot reach, so its entry point and route stay out until enabled.
export const AR_CHECK_ENABLED = false;

export function offersArCheck(): boolean {
  return AR_CHECK_ENABLED && Platform.OS === 'ios';
}
