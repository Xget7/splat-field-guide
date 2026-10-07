import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

export interface ModelViewProps extends HybridViewProps {
  /** A local USDZ model; relative paths resolve inside the app bundle. */
  modelPath: string;
  /** Degrees the model turns through: 360 spins it, less sways it either side of its front. */
  sweep: number;
  /** Seconds for one spin, or for one sway out and back. */
  period: number;
  /** True once the model shows, false when it cannot load. */
  onLoaded: (loaded: boolean) => void;
}

export type ModelView = HybridView<
  ModelViewProps,
  HybridViewMethods,
  { ios: 'swift' }
>;
