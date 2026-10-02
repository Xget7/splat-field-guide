import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/** 1..255 is a part, 0 is none. */
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

/**
 * The angles and distances the camera may take, radians and metres. An azimuth range of a
 * full turn turns freely; a narrower one, which may cross pi, keeps the camera on the side
 * that was captured.
 */
export interface CameraLimits {
  minAzimuth: number;
  maxAzimuth: number;
  minElevation: number;
  maxElevation: number;
  minRadius: number;
  maxRadius: number;
}

/** A pack tier's files on disk: absolute, or relative to the app bundle's resources. */
export interface SplatSource {
  splatPath: string;
  labelsPath: string;
}

export type SplatErrorCode = 'load-failed' | 'labels-mismatch' | 'gpu-unavailable';

export interface SplatError {
  code: SplatErrorCode;
  message: string;
}

export interface SplatViewProps extends HybridViewProps {
  /** Loaded whenever it changes; the current cloud stays on screen until the new one is. */
  source: SplatSource;
  /** Parts to emphasise, the rest dimmed; none shows the cloud as captured. */
  highlight: PartLabel[];
  /** Unset turns freely. */
  cameraLimits?: CameraLimits;
  /**
   * Seconds each cloud loaded takes to sweep in from the bottom up, a line in the accent at
   * its front. Unset shows it at once.
   */
  revealSeconds?: number;
  /** A loaded cloud is on screen. */
  onReady: () => void;
  /** Any thread. After gpu-unavailable the view stays black. */
  onError: (error: SplatError) => void;
}

/**
 * Every method only enqueues work for the view's render thread, so a gesture worklet may call
 * them; pick and project read the frame last drawn.
 */
export interface SplatViewMethods extends HybridViewMethods {
  /** Radians, stopping at the limits; stops a framing. */
  orbit(dAzimuth: number, dElevation: number): void;
  /** A pinch's scale: above one moves closer. */
  dolly(factor: number): void;
  /** Eases until `bounds` fills the view, looking from `from` or from where it looks now. */
  frame(bounds: Bounds, seconds: number, from?: ViewDirection): void;
  /** The part under (x, y), each in [0, 1] from the view's top left. */
  pick(x: number, y: number): Promise<PartLabel>;
  /**
   * Where each point of `points` (float32 x, y, z) shows, written to `out` as float32 x, y in
   * [0, 1] from the top left, NaN behind the camera. Returns how many are in front.
   */
  project(points: ArrayBuffer, out: ArrayBuffer): number;
  /** Where the frame last drawn looks from; undefined before the first. */
  drawnDirection(): ViewDirection | undefined;
}

export type SplatView = HybridView<
  SplatViewProps,
  SplatViewMethods,
  { ios: 'swift' }
>;
