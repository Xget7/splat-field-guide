import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/** 1..65535 is a part, 0 is none. */
export type PartLabel = number;

/** A point in the cloud's frame, metres, +Y up. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Where a framing looks from, radians: turned about +Y from +Z, raised above the horizontal. */
export interface ViewDirection {
  azimuth: number;
  elevation: number;
}

/** Limits use radians and metres; full-turn azimuth is free, narrower ranges may cross pi. */
export interface CameraLimits {
  minAzimuth: number;
  maxAzimuth: number;
  minElevation: number;
  maxElevation: number;
  minRadius: number;
  maxRadius: number;
}

/** How highlighted parts and the rest look; brightness scales captured colour, 1 leaves it as captured. */
export interface HighlightLook {
  /** 0xRRGGBB. */
  tintRgb: number;
  /** [0, 1]: how far a part's captured colour moves toward the tint. */
  tintAmount: number;
  /** [0, 2]. */
  partBrightness: number;
  /** [0, 2]. */
  otherBrightness: number;
}

/** A pack tier's files on disk: absolute, or relative to the app bundle's resources. */
export interface SplatSource {
  /** The tier's level-of-detail tree, a `.lodsplat` file. */
  splatPath: string;
  /** One part label per tree node, in node order. */
  labelsPath: string;
  splatSha256: string;
  labelsSha256: string;
  /** The tree's leaves, as the pack manifest records them. */
  expectedSplatCount: number;
}

export type SplatErrorCode =
  | 'load-failed'
  | 'labels-mismatch'
  | 'gpu-unavailable';

export interface SplatError {
  code: SplatErrorCode;
  message: string;
}

export interface SplatViewProps extends HybridViewProps {
  /** Loaded whenever it changes; the current cloud stays on screen until the new one is. */
  source: SplatSource;
  /** Parts to emphasise in the highlight look; none shows the cloud as captured. */
  highlight: PartLabel[];
  /** Unset keeps the engine's look. */
  highlightLook?: HighlightLook;
  /** Unset turns freely. */
  cameraLimits?: CameraLimits;
  /** Cloud reveal duration in seconds, from bottom to top; unset shows it at once. */
  revealSeconds?: number;
  /** A loaded cloud is on screen. */
  onReady: () => void;
  /** Any thread. After gpu-unavailable the view stays black. */
  onError: (error: SplatError) => void;
}

/** Worklets enqueue mutations; pick uses a worker, while project/drawnDirection read the last frame. */
export interface SplatViewMethods extends HybridViewMethods {
  /** Radians, stopping at the limits; stops a framing. */
  orbit(dAzimuth: number, dElevation: number): void;
  /** A pinch's scale: above one moves closer. */
  dolly(factor: number): void;
  /** Eases until `bounds` fills the view, looking from `from` or from where it looks now. */
  frame(bounds: Bounds, seconds: number, from?: ViewDirection): void;
  /** The part under (x, y), each in [0, 1] from the view's top left. */
  pick(x: number, y: number): Promise<PartLabel>;
  /** Projects float32 xyz into float32 xy from the top left in [0, 1], with NaN behind the camera, returning the count in front. */
  project(points: ArrayBuffer, out: ArrayBuffer): number;
  /** Where the frame last drawn looks from; undefined before the first. */
  drawnDirection(): ViewDirection | undefined;
}

export type SplatView = HybridView<
  SplatViewProps,
  SplatViewMethods,
  { ios: 'swift'; android: 'kotlin' }
>;
