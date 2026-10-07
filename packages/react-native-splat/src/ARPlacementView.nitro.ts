import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

export type ARPlacementState =
  | 'loading'
  | 'requesting-permission'
  | 'permission-denied'
  | 'unsupported'
  | 'searching'
  | 'ready'
  | 'placed'
  | 'limited'
  | 'paused'
  | 'error';

export interface ARPlacementEvent {
  state: ARPlacementState;
  message: string;
  scale: number;
  placed: boolean;
}

export interface ARAssemblyPart {
  id: string;
  label: string;
}

export type ARAssemblyPhase =
  | 'idle'
  | 'assembling'
  | 'separating'
  | 'previewing';

export interface ARAssemblyEvent {
  parts: ARAssemblyPart[];
  assembledCount: number;
  requestId: number;
  phase: ARAssemblyPhase;
}

export interface ARPlacementViewProps extends HybridViewProps {
  /** A local USDZ capture; relative paths resolve inside the app bundle. */
  modelPath: string;
  /** Uniform size relative to the capture, clamped to 0.1 through 2. */
  scale: number;
  /** Metres above the detected plane, clamped to 0 through 2; defaults to zero. */
  elevation?: number;
  /** Increment with a scale change; gesture feedback does not issue a new command. */
  scaleRequest: number;
  /** Increment to place at the centre of a detected horizontal surface. */
  placementRequest: number;
  /** Increment to remove the placement and search for another surface. */
  resetRequest: number;
  onPlacementChanged: (event: ARPlacementEvent) => void;
  /** Number of parts to assemble in the visual tour; omitted disables the tour. */
  assemblyStep?: number;
  /** Increment for each assembly or preview command; idle acknowledges its completion. */
  assemblyRequest?: number;
  /** Part names in the source animation's visual assembly order. */
  assemblyOrder?: string[];
  /** Move the remaining pieces apart; false previews the complete equipment. */
  exploded?: boolean;
  onAssemblyChanged?: (event: ARAssemblyEvent) => void;
}

export type ARPlacementView = HybridView<
  ARPlacementViewProps,
  HybridViewMethods,
  { ios: 'swift' }
>;
