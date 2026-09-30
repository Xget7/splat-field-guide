import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

/** 1..255 is a part, 0 is none. */
export type PartLabel = number;

export interface SplatViewProps extends HybridViewProps {
  /** Parts to emphasise; the render thread reads it without a JS hop. */
  highlight: PartLabel[];
  /** Fired from the render thread after the first presented frame. */
  onReady: () => void;
}

export interface SplatViewMethods extends HybridViewMethods {
  /** Only enqueues work for the render thread, so a gesture worklet may call it. */
  orbit(dAzimuth: number, dElevation: number): void;
}

export type SplatView = HybridView<
  SplatViewProps,
  SplatViewMethods,
  { ios: 'swift' }
>;
