import { Platform } from 'react-native';
import config from '../../instructor.config.json';
import {
  appEvents,
  createInstructorRuntime,
  OfflineVoices,
  type InstructorRuntime,
} from '../features/instructor';
import { createPlatform } from './platform';

/** Builds the app's one instructor from the production platform and the proxy configuration. */
export function createAppInstructor(): InstructorRuntime {
  return createInstructorRuntime({
    platform: createPlatform(),
    proxyUrl: config.proxyUrl,
    offlineVoice:
      Platform.OS === 'ios' ? OfflineVoices.kokoro : OfflineVoices.system,
    appEvents,
  });
}
