import { getBundledPacks } from 'react-native-splat';
import {
  loadBundledPacks,
  type BundledPacksResult,
} from '../../features/pack/bundledPack';

/** The packs this build bundled; installed packs will join them here once delivery exists. */
export function loadAppPacks(): BundledPacksResult {
  return loadBundledPacks(getBundledPacks());
}
