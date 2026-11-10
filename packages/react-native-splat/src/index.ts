import { getHostComponent } from 'react-native-nitro-modules';
import SplatViewConfig from '../nitrogen/generated/shared/json/SplatViewConfig.json';
import ModelViewConfig from '../nitrogen/generated/shared/json/ModelViewConfig.json';
import type { HybridViewMethods } from 'react-native-nitro-modules';
import type { ModelViewProps } from './ModelView.nitro';
import type { SplatViewMethods, SplatViewProps } from './SplatView.nitro';

export type {
  ModelView as ModelViewSpec,
  ModelViewProps,
} from './ModelView.nitro';
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

/** iOS only: a bundled USDZ model turning on a transparent background. */
export const ModelView = getHostComponent<ModelViewProps, HybridViewMethods>(
  'ModelView',
  () => ModelViewConfig,
);
