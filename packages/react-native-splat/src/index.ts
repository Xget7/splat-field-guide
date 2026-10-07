import { getHostComponent } from 'react-native-nitro-modules';
import type { HybridViewMethods } from 'react-native-nitro-modules';
import ARGuideViewConfig from '../nitrogen/generated/shared/json/ARGuideViewConfig.json';
import ARPlacementViewConfig from '../nitrogen/generated/shared/json/ARPlacementViewConfig.json';
import ModelViewConfig from '../nitrogen/generated/shared/json/ModelViewConfig.json';
import SplatViewConfig from '../nitrogen/generated/shared/json/SplatViewConfig.json';
import type { ARGuideViewProps } from './ARGuideView.nitro';
import type { ARPlacementViewProps } from './ARPlacementView.nitro';
import type { ModelViewProps } from './ModelView.nitro';
import type { SplatViewMethods, SplatViewProps } from './SplatView.nitro';

export type {
  ARPlacementView as ARPlacementViewSpec,
  ARPlacementViewProps,
  ARPlacementState,
  ARPlacementEvent,
  ARAssemblyPart,
  ARAssemblyEvent,
  ARAssemblyPhase,
} from './ARPlacementView.nitro';
export type {
  ARGuideView as ARGuideViewSpec,
  ARGuideViewProps,
  ARTrackingState,
  ARCameraTracking,
  ARTrackingTelemetry,
  ARTrackingEvent,
} from './ARGuideView.nitro';
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

export const ARGuideView = getHostComponent<
  ARGuideViewProps,
  HybridViewMethods
>('ARGuideView', () => ARGuideViewConfig);

export const ARPlacementView = getHostComponent<
  ARPlacementViewProps,
  HybridViewMethods
>('ARPlacementView', () => ARPlacementViewConfig);

/** iOS only: a bundled USDZ model turning on a transparent background. */
export const ModelView = getHostComponent<ModelViewProps, HybridViewMethods>(
  'ModelView',
  () => ModelViewConfig,
);
