import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

export type ARTrackingState =
  | 'loading'
  | 'requesting-permission'
  | 'permission-denied'
  | 'unsupported'
  | 'searching'
  | 'tracking'
  | 'limited'
  | 'paused'
  | 'error';

export type ARCameraTracking =
  | 'normal'
  | 'notAvailable'
  | 'limited:initializing'
  | 'limited:excessiveMotion'
  | 'limited:insufficientFeatures'
  | 'limited:relocalizing'
  | 'limited';

/** Camera metadata sampled on device at 1 Hz, not model confidence or inference rate. */
export interface ARTrackingTelemetry {
  sampleTimestamp: number;
  cameraTracking: ARCameraTracking;
  cameraFramesPerSecond: number;
  objectAnchors: number;
  trackedObjectAnchors: number;
  allObjectAnchors: number;
  sessionSeconds: number;
  pinsEnabled: boolean;
}

export interface ARTrackingEvent {
  state: ARTrackingState;
  message: string;
  torchAvailable: boolean;
  torchEnabled: boolean;
  torchError?: string;
  referenceLoaded?: boolean;
  telemetry?: ARTrackingTelemetry;
}

export interface ARGuideViewProps extends HybridViewProps {
  /** A local .referenceobject archive; relative paths resolve inside the app bundle. */
  referencePath: string;
  /** Local JSON with referenceFromPack and four landmarks in the pack's coordinates. */
  landmarksPath: string;
  /** Continuous rear-camera light. Changing this does not restart recognition. */
  torchEnabled: boolean;
  /** Recognition state, actual torch state and optional camera metadata. */
  onTrackingStateChanged: (event: ARTrackingEvent) => void;
}

export type ARGuideView = HybridView<
  ARGuideViewProps,
  HybridViewMethods,
  { ios: 'swift' }
>;
