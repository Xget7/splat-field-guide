import type { HybridObject } from 'react-native-nitro-modules';

/** One pack directory shipped in the app, with its manifest as written. */
export interface BundledPackManifest {
  /** `<packId>/<packVersion>`, relative to the bundled `packs` directory. */
  directory: string;
  /** The directory's `manifest.json` as UTF-8 text, for the app's parser to validate. */
  manifest: string;
}

/**
 * Packs the build copied into the app, read where the viewer resolves relative pack paths, so a
 * manifest and the files it describes always come from the same place.
 */
export interface BundledPacks
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** Every `packs/<packId>/<packVersion>/manifest.json`, sorted by directory; none when no pack is bundled. */
  manifests(): BundledPackManifest[];
}
