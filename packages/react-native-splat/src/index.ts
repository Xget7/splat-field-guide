import { getHostComponent } from 'react-native-nitro-modules';
import SplatViewConfig from '../nitrogen/generated/shared/json/SplatViewConfig.json';
import type { SplatViewMethods, SplatViewProps } from './SplatView.nitro';

export type {
  Bounds,
  CameraLimits,
  PartLabel,
  SplatError,
  SplatErrorCode,
  SplatSource,
  SplatView as SplatViewSpec,
  SplatViewMethods,
  SplatViewProps,
  Vec3,
  ViewDirection,
} from './SplatView.nitro';

export const SplatView = getHostComponent<SplatViewProps, SplatViewMethods>(
  'SplatView',
  () => SplatViewConfig,
);

export { getBundledPacks, type BundledPackManifest } from './bundledPacks';
