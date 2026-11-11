import { NitroModules } from 'react-native-nitro-modules';
import type { BundledPacks } from './BundledPacks.nitro';

export type { BundledPackManifest } from './BundledPacks.nitro';

/** Reads the pack manifests the build copied into the app. */
export function getBundledPacks(): BundledPacks {
  return NitroModules.createHybridObject<BundledPacks>('BundledPacks');
}
