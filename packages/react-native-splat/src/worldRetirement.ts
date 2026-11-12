import { NitroModules } from 'react-native-nitro-modules';
import type { WorldRetirement } from './WorldRetirement.nitro';

/**
 * Call after unmounting world views, while preventing new mounts. Resolves after native render
 * hosts, in-flight load/pick owners and their GPU resources have actually retired.
 * This is a drain fence, not an admission lock against future mounts.
 */
export function waitForWorldsReleased(): Promise<void> {
  return NitroModules.createHybridObject<WorldRetirement>(
    'WorldRetirement',
  ).waitForWorldsReleased();
}
