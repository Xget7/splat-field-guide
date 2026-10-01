import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules';

export interface ARGuideViewProps extends HybridViewProps {
  /** A local .referenceobject archive; relative paths resolve inside the app bundle. */
  referencePath: string;
  /** Local JSON with referenceFromPack and four landmarks in the pack's coordinates. */
  landmarksPath: string;
  /** JSON {state,message}, optionally including referenceCenter/Extent/Scale diagnostics. */
  onTrackingStateChanged: (eventJson: string) => void;
}

export type ARGuideView = HybridView<
  ARGuideViewProps,
  HybridViewMethods,
  { ios: 'swift' }
>;
