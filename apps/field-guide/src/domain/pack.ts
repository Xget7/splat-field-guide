export const SUPPORTED_SCHEMA_VERSION = 1;

// A part label is one byte in labels.bin and zero means "no part".
export const PART_LABEL_MIN = 1;
export const PART_LABEL_MAX = 255;

export type PartId = string;
export type ProcedureId = string;
export type PartLabel = number;

export type Vec3 = readonly [number, number, number];

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface PackFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface Tier {
  readonly id: string;
  readonly splatCount: number;
  readonly cloud: PackFile;
  readonly labels: PackFile;
}

export interface CameraHome {
  readonly azimuth: number;
  readonly elevation: number;
  readonly radius: number;
}

export interface CameraLimits {
  /** Degrees; a span of exactly 360 means the orbit has no azimuth limit. */
  readonly minAzimuth: number;
  readonly maxAzimuth: number;
  readonly minElevation: number;
  readonly maxElevation: number;
  readonly minRadius: number;
  readonly maxRadius: number;
}

export interface Part {
  readonly id: PartId;
  readonly label: PartLabel;
  readonly parent: PartId | null;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly summary: string;
  readonly details: string;
  readonly bounds: Bounds;
  readonly anchor: Vec3;
}

export interface Step {
  readonly id: string;
  readonly text: string;
  readonly parts: readonly PartId[];
  readonly caution: string;
}

export interface Procedure {
  readonly id: ProcedureId;
  readonly title: string;
  readonly steps: readonly Step[];
}

export interface Pack {
  readonly schemaVersion: number;
  readonly packId: string;
  readonly packVersion: number;
  readonly title: string;
  readonly tiers: readonly Tier[];
  readonly camera: { readonly home: CameraHome; readonly limits: CameraLimits };
  readonly parts: readonly Part[];
  readonly procedures: readonly Procedure[];
}

export function findPart(pack: Pack, id: PartId): Part | undefined {
  return pack.parts.find(part => part.id === id);
}

export function findProcedure(
  pack: Pack,
  id: ProcedureId,
): Procedure | undefined {
  return pack.procedures.find(procedure => procedure.id === id);
}

/** The part plus every part inside it, at any depth. */
export function partsWithin(pack: Pack, id: PartId): readonly Part[] {
  const root = findPart(pack, id);
  if (!root) {
    return [];
  }
  const found: Part[] = [];
  const seen = new Set<PartId>();
  const queue: Part[] = [root];
  while (queue.length > 0) {
    const part = queue.shift() as Part;
    // The guard keeps a hand-built pack with a cycle from looping forever.
    if (seen.has(part.id)) {
      continue;
    }
    seen.add(part.id);
    found.push(part);
    queue.push(...pack.parts.filter(child => child.parent === part.id));
  }
  return found;
}
