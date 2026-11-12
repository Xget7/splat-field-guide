import config from '../../../instructor.config.json';
import {
  createInstructor,
  instructorStore,
  type Instructor,
} from '../../features/instructor';
import { createPlatform } from '../platform';
import { createAppKnowledge } from './knowledge';

/**
 * Builds the app's one instructor from the production platform and the proxy configuration,
 * and attaches it to the store screens read it from.
 */
export function createAppInstructor(): Instructor {
  const instructor = createInstructor({
    platform: createPlatform(),
    knowledge: createAppKnowledge(),
    proxyUrl: config.proxyUrl,
    store: instructorStore,
  });
  instructorStore.getState().attach(instructor);
  return instructor;
}
