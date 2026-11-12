import type { HybridObject } from 'react-native-nitro-modules';

/** Native destruction, not merely a queued stop or React unmount acknowledgement. */
export interface WorldRetirement
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  waitForWorldsReleased(): Promise<void>;
}
