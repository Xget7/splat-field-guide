import { Platform } from 'react-native';
import config from '../../../instructor.config.json';
import {
  createInstructor,
  instructorStore,
  OfflineVoices,
  type Instructor,
} from '../../features/instructor';
import { createPlatform } from '../platform';

/**
 * Builds the app's one instructor from the production platform and the proxy configuration,
 * and attaches it to the store screens read it from.
 */
export function createAppInstructor(): Instructor {
  const instructor = createInstructor({
    platform: createPlatform(),
    proxyUrl: config.proxyUrl,
    offlineVoice:
      Platform.OS === 'ios' ? OfflineVoices.kokoro : OfflineVoices.system,
    store: instructorStore,
  });
  instructorStore.getState().attach(instructor);
  return instructor;
}
