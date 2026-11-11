import type { Pack } from './pack';
import { parsePack } from './parsePack';

/** One pack directory the app bundle carries, with its manifest text as written. */
export interface BundledManifest {
  /** `<packId>/<packVersion>` under the bundle's `packs` directory. */
  readonly directory: string;
  readonly manifest: string;
}

/** Lists the bundle's pack manifests; the native reader reads where the viewer resolves pack files. */
export interface BundledPackReader {
  manifests(): readonly BundledManifest[];
}

export type BundledPacksResult =
  | { readonly ok: true; readonly packs: readonly Pack[] }
  | { readonly ok: false; readonly message: string };

/**
 * Validates every bundled pack with the consumer parser. The build selected and verified each
 * one, so any failure means a broken bundle and fails startup rather than hiding that pack.
 */
export function loadBundledPacks(
  reader: BundledPackReader,
): BundledPacksResult {
  let entries: readonly BundledManifest[];
  try {
    entries = reader.manifests();
  } catch (error) {
    return { ok: false, message: `Bundled packs are unreadable: ${error}` };
  }
  const packs: Pack[] = [];
  for (const { directory, manifest } of entries) {
    let json: unknown;
    try {
      json = JSON.parse(manifest);
    } catch {
      return { ok: false, message: `${directory}: manifest is not JSON` };
    }
    const parsed = parsePack(json);
    if (!parsed.ok) {
      const where = parsed.error.path ? `${parsed.error.path}: ` : '';
      return {
        ok: false,
        message: `${directory}: ${where}${parsed.error.message}`,
      };
    }
    // Runtime paths are derived from the identity, so it must name the directory it came from.
    const identity = `${parsed.pack.packId}/${parsed.pack.packVersion}`;
    if (identity !== directory) {
      return {
        ok: false,
        message: `${directory}: manifest identifies ${identity}`,
      };
    }
    packs.push(parsed.pack);
  }
  return { ok: true, packs };
}

// Names follow the native SplatSource: the splat file is the tier's tree and the count its leaves.
export interface PackSource {
  readonly splatPath: string;
  readonly labelsPath: string;
  readonly splatSha256: string;
  readonly labelsSha256: string;
  readonly expectedSplatCount: number;
}

export function sourceFor(pack: Pack): PackSource {
  const baseDirectory = `packs/${pack.packId}/${pack.packVersion}/`;
  const tier = pack.tiers[0];
  return {
    splatPath: baseDirectory + tier.world.path,
    labelsPath: baseDirectory + tier.labels.path,
    splatSha256: tier.world.sha256,
    labelsSha256: tier.labels.sha256,
    expectedSplatCount: tier.splatCount,
  };
}
