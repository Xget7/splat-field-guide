import { getBundledPacks } from 'react-native-splat';
import {
  loadBundledPacks,
  type BundledPacksResult,
} from '../../features/pack/bundledPack';

/** The packs this build bundled; installed packs will join them here once delivery exists. */
export function loadAppPacks(): BundledPacksResult {
  // Create the native reader inside the loader's failure boundary as registration can fail.
  return loadBundledPacks({ manifests: () => getBundledPacks().manifests() });
}
