import { getHostComponent } from 'react-native-nitro-modules';
import type { HybridViewMethods } from 'react-native-nitro-modules';
import ARGuideViewConfig from '../nitrogen/generated/shared/json/ARGuideViewConfig.json';
import SplatViewConfig from '../nitrogen/generated/shared/json/SplatViewConfig.json';
import type { ARGuideViewProps } from './ARGuideView.nitro';
import type { SplatViewMethods, SplatViewProps } from './SplatView.nitro';

export type {
  ARGuideView as ARGuideViewSpec,
  ARGuideViewProps,
  ARTrackingState,
  ARCameraTracking,
  ARTrackingTelemetry,
  ARTrackingEvent,
} from './ARGuideView.nitro';
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
