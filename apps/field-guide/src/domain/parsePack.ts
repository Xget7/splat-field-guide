import {
  Bounds,
  CameraHome,
  CameraLimits,
  PART_LABEL_MAX,
  PART_LABEL_MIN,
  Pack,
  PackFile,
  Part,
  PartId,
  Procedure,
  Step,
  SUPPORTED_SCHEMA_VERSION,
  Tier,
  Vec3,
} from './pack';

export const PackErrorCode = {
  invalidField: 'invalidField',
  unsupportedSchemaVersion: 'unsupportedSchemaVersion',
  duplicatePartId: 'duplicatePartId',
  duplicatePartLabel: 'duplicatePartLabel',
  labelOutOfRange: 'labelOutOfRange',
  unknownParent: 'unknownParent',
  parentCycle: 'parentCycle',
  unknownStepPart: 'unknownStepPart',
  duplicateProcedureId: 'duplicateProcedureId',
  duplicateStepId: 'duplicateStepId',
} as const;
export type PackErrorCode = (typeof PackErrorCode)[keyof typeof PackErrorCode];

export interface PackError {
  readonly code: PackErrorCode;
  /** Where in the manifest, such as `parts[2].label`; empty for the root. */
  readonly path: string;
  readonly message: string;
}

export type ParsePackResult =
  | { readonly ok: true; readonly pack: Pack }
  | { readonly ok: false; readonly error: PackError };

/** Validates an unknown JSON value into a Pack; never throws on bad input. */
export function parsePack(value: unknown): ParsePackResult {
  try {
    return { ok: true, pack: buildPack(value) };
  } catch (thrown) {
    if (thrown instanceof PackFailure) {
      return { ok: false, error: thrown.error };
    }
    throw thrown;
  }
}

// Internal only: lets the readers stay flat; parsePack turns it into a result.
class PackFailure extends Error {
  constructor(readonly error: PackError) {
    super(error.message);
  }
}

function fail(code: PackErrorCode, path: string, message: string): never {
  throw new PackFailure({ code, path, message });
}

type Json = Record<string, unknown>;

function at(path: string, key: string | number): string {
  if (typeof key === 'number') {
    return `${path}[${key}]`;
  }
  return path === '' ? key : `${path}.${key}`;
}

function readObject(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(PackErrorCode.invalidField, path, 'expected an object');
  }
  return value as Json;
}

function readArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    return fail(PackErrorCode.invalidField, path, 'expected an array');
  }
  return value;
}

function readText(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    return fail(PackErrorCode.invalidField, path, 'expected a string');
  }
  return value;
}

function readName(value: unknown, path: string): string {
  const text = readText(value, path);
  if (text.trim() === '') {
    return fail(
      PackErrorCode.invalidField,
      path,
      'expected a non-empty string',
    );
  }
  return text;
}

function readNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(PackErrorCode.invalidField, path, 'expected a finite number');
  }
  return value;
}

function readCount(value: unknown, path: string): number {
  const number = readNumber(value, path);
  if (!Number.isInteger(number) || number < 0) {
    return fail(
      PackErrorCode.invalidField,
      path,
      'expected a non-negative integer',
    );
  }
  return number;
}

function readOptionalText(value: unknown, path: string): string {
  return value === undefined ? '' : readText(value, path);
}

function readVec3(value: unknown, path: string): Vec3 {
  const items = readArray(value, path);
  if (items.length !== 3) {
    return fail(PackErrorCode.invalidField, path, 'expected three numbers');
  }
  return [
    readNumber(items[0], at(path, 0)),
    readNumber(items[1], at(path, 1)),
    readNumber(items[2], at(path, 2)),
  ];
}

function readBounds(value: unknown, path: string): Bounds {
  const object = readObject(value, path);
  const min = readVec3(object.min, at(path, 'min'));
  const max = readVec3(object.max, at(path, 'max'));
  if (min.some((low, axis) => low > max[axis])) {
    return fail(PackErrorCode.invalidField, path, 'min exceeds max');
  }
  return { min, max };
}

function readFile(value: unknown, path: string): PackFile {
  const object = readObject(value, path);
  return {
    path: readName(object.path, at(path, 'path')),
    bytes: readCount(object.bytes, at(path, 'bytes')),
    sha256: readText(object.sha256, at(path, 'sha256')),
  };
}

function readTier(value: unknown, path: string): Tier {
  const object = readObject(value, path);
  return {
    id: readName(object.id, at(path, 'id')),
    splatCount: readCount(object.splatCount, at(path, 'splatCount')),
    cloud: readFile(object.cloud, at(path, 'cloud')),
    labels: readFile(object.labels, at(path, 'labels')),
  };
}

function readCamera(
  value: unknown,
  path: string,
): { home: CameraHome; limits: CameraLimits } {
  const object = readObject(value, path);
  const home = readObject(object.home, at(path, 'home'));
  const limits = readObject(object.limits, at(path, 'limits'));
  const num = (source: Json, base: string, key: string) =>
    readNumber(source[key], at(at(path, base), key));
  return {
    home: {
      azimuth: num(home, 'home', 'azimuth'),
      elevation: num(home, 'home', 'elevation'),
      radius: num(home, 'home', 'radius'),
    },
    limits: {
      minElevation: num(limits, 'limits', 'minElevation'),
      maxElevation: num(limits, 'limits', 'maxElevation'),
      minRadius: num(limits, 'limits', 'minRadius'),
      maxRadius: num(limits, 'limits', 'maxRadius'),
    },
  };
}

function readLabel(value: unknown, path: string): number {
  const label = readNumber(value, path);
  if (
    !Number.isInteger(label) ||
    label < PART_LABEL_MIN ||
    label > PART_LABEL_MAX
  ) {
    return fail(
      PackErrorCode.labelOutOfRange,
      path,
      `label must be an integer from ${PART_LABEL_MIN} to ${PART_LABEL_MAX}`,
    );
  }
  return label;
}

function readPart(value: unknown, path: string): Part {
  const object = readObject(value, path);
  const parent = object.parent;
  return {
    id: readName(object.id, at(path, 'id')),
    label: readLabel(object.label, at(path, 'label')),
    parent:
      parent === null || parent === undefined
        ? null
        : readName(parent, at(path, 'parent')),
    name: readName(object.name, at(path, 'name')),
    aliases:
      object.aliases === undefined
        ? []
        : readArray(object.aliases, at(path, 'aliases')).map((alias, index) =>
            readName(alias, at(at(path, 'aliases'), index)),
          ),
    summary: readOptionalText(object.summary, at(path, 'summary')),
    details: readOptionalText(object.details, at(path, 'details')),
    bounds: readBounds(object.bounds, at(path, 'bounds')),
    anchor: readVec3(object.anchor, at(path, 'anchor')),
  };
}

function readStep(value: unknown, path: string): Step {
  const object = readObject(value, path);
  const partsPath = at(path, 'parts');
  return {
    id: readName(object.id, at(path, 'id')),
    text: readText(object.text, at(path, 'text')),
    parts: readArray(object.parts, partsPath).map((id, index) =>
      readName(id, at(partsPath, index)),
    ),
    caution: readOptionalText(object.caution, at(path, 'caution')),
  };
}

function readProcedure(value: unknown, path: string): Procedure {
  const object = readObject(value, path);
  const stepsPath = at(path, 'steps');
  const steps = readArray(object.steps, stepsPath).map((step, index) =>
    readStep(step, at(stepsPath, index)),
  );
  if (steps.length === 0) {
    return fail(PackErrorCode.invalidField, stepsPath, 'expected a step');
  }
  return {
    id: readName(object.id, at(path, 'id')),
    title: readName(object.title, at(path, 'title')),
    steps,
  };
}

function checkParts(parts: readonly Part[]): void {
  const ids = new Set<PartId>();
  const labels = new Set<number>();
  parts.forEach((part, index) => {
    if (ids.has(part.id)) {
      fail(
        PackErrorCode.duplicatePartId,
        at(at('parts', index), 'id'),
        `part id "${part.id}" is used twice`,
      );
    }
    ids.add(part.id);
    if (labels.has(part.label)) {
      fail(
        PackErrorCode.duplicatePartLabel,
        at(at('parts', index), 'label'),
        `part label ${part.label} is used twice`,
      );
    }
    labels.add(part.label);
  });
  parts.forEach((part, index) => {
    if (part.parent !== null && !ids.has(part.parent)) {
      fail(
        PackErrorCode.unknownParent,
        at(at('parts', index), 'parent'),
        `part "${part.id}" has unknown parent "${part.parent}"`,
      );
    }
  });
  const parentOf = new Map(parts.map(part => [part.id, part.parent]));
  parts.forEach((part, index) => {
    const walked = new Set<PartId>([part.id]);
    let next = part.parent;
    while (next !== null && next !== undefined) {
      if (walked.has(next)) {
        fail(
          PackErrorCode.parentCycle,
          at(at('parts', index), 'parent'),
          `part "${part.id}" is inside itself`,
        );
      }
      walked.add(next);
      next = parentOf.get(next) ?? null;
    }
  });
}

function checkProcedures(
  procedures: readonly Procedure[],
  parts: readonly Part[],
): void {
  const partIds = new Set(parts.map(part => part.id));
  const procedureIds = new Set<string>();
  procedures.forEach((procedure, p) => {
    const base = at('procedures', p);
    if (procedureIds.has(procedure.id)) {
      fail(
        PackErrorCode.duplicateProcedureId,
        at(base, 'id'),
        `procedure id "${procedure.id}" is used twice`,
      );
    }
    procedureIds.add(procedure.id);
    const stepIds = new Set<string>();
    procedure.steps.forEach((step, s) => {
      const stepBase = at(at(base, 'steps'), s);
      if (stepIds.has(step.id)) {
        fail(
          PackErrorCode.duplicateStepId,
          at(stepBase, 'id'),
          `step id "${step.id}" is used twice in "${procedure.id}"`,
        );
      }
      stepIds.add(step.id);
      step.parts.forEach((id, i) => {
        if (!partIds.has(id)) {
          fail(
            PackErrorCode.unknownStepPart,
            at(at(stepBase, 'parts'), i),
            `step "${step.id}" names unknown part "${id}"`,
          );
        }
      });
    });
  });
}

function buildPack(value: unknown): Pack {
  const root = readObject(value, '');
  const version = readNumber(root.schemaVersion, 'schemaVersion');
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    fail(
      PackErrorCode.unsupportedSchemaVersion,
      'schemaVersion',
      `schema version ${version} is not supported`,
    );
  }
  const tiers = readArray(root.tiers, 'tiers').map((tier, index) =>
    readTier(tier, at('tiers', index)),
  );
  if (tiers.length === 0) {
    fail(PackErrorCode.invalidField, 'tiers', 'expected a tier');
  }
  const parts = readArray(root.parts, 'parts').map((part, index) =>
    readPart(part, at('parts', index)),
  );
  const procedures = readArray(root.procedures, 'procedures').map(
    (procedure, index) => readProcedure(procedure, at('procedures', index)),
  );
  checkParts(parts);
  checkProcedures(procedures, parts);
  return {
    schemaVersion: version,
    packId: readName(root.packId, 'packId'),
    packVersion: readCount(root.packVersion, 'packVersion'),
    title: readName(root.title, 'title'),
    tiers,
    camera: readCamera(root.camera, 'camera'),
    parts,
    procedures,
  };
}
