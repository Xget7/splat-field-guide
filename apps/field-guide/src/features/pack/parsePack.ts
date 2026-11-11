import {
  Bounds,
  CameraHome,
  CameraLimits,
  EvidenceKind,
  PART_LABEL_MAX,
  PART_LABEL_MIN,
  Pack,
  PackFile,
  PackSemantic,
  PackSources,
  NoteTopic,
  Part,
  PartNote,
  PartId,
  Procedure,
  Relation,
  RelationEvidence,
  RelationType,
  Step,
  SUPPORTED_SCHEMA_VERSION,
  Tier,
  Vec3,
  VectorKind,
  VectorRow,
  VectorSpace,
} from './pack';
import { TOUR_ID, tourOf } from './tour';

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
  reservedProcedureId: 'reservedProcedureId',
  unknownRelationPart: 'unknownRelationPart',
  selfRelation: 'selfRelation',
  duplicateRelation: 'duplicateRelation',
  carriesCycle: 'carriesCycle',
  unknownVectorPart: 'unknownVectorPart',
  duplicateVectorRow: 'duplicateVectorRow',
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

// Throw internally to keep readers flat, then return a result at the parser boundary.
class PackFailure extends Error {
  constructor(readonly error: PackError) {
    super(error.message);
  }
}

function fail(code: PackErrorCode, path: string, message: string): never {
  throw new PackFailure({ code, path, message });
}

type Json = Record<string, unknown>;

const FULL_TURN_DEGREES = 360;
const POLE_DEGREES = 90;
// SFGL v2 stores a 16-byte header followed by two bytes per tree node.
const LABELS_HEADER_BYTES = 16;
const FLOAT32_BYTES = 4;

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
  const filePath = readName(object.path, at(path, 'path'));
  if (
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*\.[a-zA-Z0-9]+$/.test(filePath) ||
    filePath.split('/').some(segment => segment === '..' || segment === '.')
  ) {
    return fail(
      PackErrorCode.invalidField,
      at(path, 'path'),
      'expected a relative file path',
    );
  }
  return {
    path: filePath,
    bytes: readCount(object.bytes, at(path, 'bytes')),
    sha256: readDigest(object.sha256, at(path, 'sha256')),
  };
}

function readDigest(value: unknown, path: string): string {
  const digest = readText(value, path);
  if (digest.length !== 64 || !/^[a-f0-9]{64}$/.test(digest)) {
    return fail(PackErrorCode.invalidField, path, 'expected a SHA-256 digest');
  }
  return digest;
}

function readSources(
  value: unknown,
  parts: readonly Part[],
): PackSources | undefined {
  if (value === undefined) {
    return undefined;
  }
  const object = readObject(value, 'sources');
  const mapping = readObject(object.partLabels, 'sources.partLabels');
  if (
    Object.keys(mapping).length !== parts.length ||
    parts.some(part => mapping[part.id] !== part.label)
  ) {
    return fail(
      PackErrorCode.invalidField,
      'sources.partLabels',
      'mapping differs from the parts',
    );
  }
  const sourceFile = (key: string): PackFile => {
    return readFile(object[key], at('sources', key));
  };
  return {
    captureSha256: readDigest(object.captureSha256, 'sources.captureSha256'),
    reconstructionSha256: readDigest(
      object.reconstructionSha256,
      'sources.reconstructionSha256',
    ),
    ply: sourceFile('ply'),
    labels: sourceFile('labels'),
    liftingReport: sourceFile('liftingReport'),
    content: sourceFile('content'),
    knowledge: sourceFile('knowledge'),
    partLabels: Object.fromEntries(parts.map(part => [part.id, part.label])),
  };
}

function readTier(value: unknown, path: string): Tier {
  const object = readObject(value, path);
  const splatCount = readCount(object.splatCount, at(path, 'splatCount'));
  const nodeCount = readCount(object.nodeCount, at(path, 'nodeCount'));
  // Every leaf is a node, so a smaller node count cannot describe the tree.
  if (nodeCount < splatCount) {
    fail(
      PackErrorCode.invalidField,
      at(path, 'nodeCount'),
      'expected at least one node per leaf',
    );
  }
  const world = readFile(object.world, at(path, 'world'));
  const labels = readFile(object.labels, at(path, 'labels'));
  if (labels.bytes !== LABELS_HEADER_BYTES + nodeCount * 2) {
    fail(
      PackErrorCode.invalidField,
      at(at(path, 'labels'), 'bytes'),
      'expected a 16-byte header and two label bytes per tree node',
    );
  }
  return {
    id: readName(object.id, at(path, 'id')),
    splatCount,
    nodeCount,
    world,
    labels,
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
  const camera = {
    home: {
      azimuth: num(home, 'home', 'azimuth'),
      elevation: num(home, 'home', 'elevation'),
      radius: num(home, 'home', 'radius'),
    },
    limits: {
      minAzimuth: num(limits, 'limits', 'minAzimuth'),
      maxAzimuth: num(limits, 'limits', 'maxAzimuth'),
      minElevation: num(limits, 'limits', 'minElevation'),
      maxElevation: num(limits, 'limits', 'maxElevation'),
      minRadius: num(limits, 'limits', 'minRadius'),
      maxRadius: num(limits, 'limits', 'maxRadius'),
    },
  };
  checkCamera(camera, path);
  return camera;
}

function checkCamera(
  camera: { home: CameraHome; limits: CameraLimits },
  path: string,
): void {
  const limitsPath = at(path, 'limits');
  const homePath = at(path, 'home');
  const { home, limits } = camera;
  const invalid = (where: string, message: string) =>
    fail(PackErrorCode.invalidField, where, message);

  (['minAzimuth', 'maxAzimuth'] as const).forEach(key => {
    if (Math.abs(limits[key]) > FULL_TURN_DEGREES) {
      invalid(
        at(limitsPath, key),
        `expected degrees within ${-FULL_TURN_DEGREES} to ${FULL_TURN_DEGREES}`,
      );
    }
  });
  if (limits.minAzimuth >= limits.maxAzimuth) {
    invalid(at(limitsPath, 'maxAzimuth'), 'maxAzimuth must exceed minAzimuth');
  }
  if (limits.maxAzimuth - limits.minAzimuth > FULL_TURN_DEGREES) {
    invalid(
      at(limitsPath, 'maxAzimuth'),
      `azimuth span exceeds ${FULL_TURN_DEGREES} degrees`,
    );
  }
  (['minElevation', 'maxElevation'] as const).forEach(key => {
    if (Math.abs(limits[key]) >= POLE_DEGREES) {
      invalid(
        at(limitsPath, key),
        `expected degrees strictly between ${-POLE_DEGREES} and ${POLE_DEGREES}`,
      );
    }
  });
  if (limits.minElevation > limits.maxElevation) {
    invalid(
      at(limitsPath, 'maxElevation'),
      'maxElevation is below minElevation',
    );
  }
  if (limits.minRadius <= 0) {
    invalid(at(limitsPath, 'minRadius'), 'expected a positive radius');
  }
  if (limits.minRadius > limits.maxRadius) {
    invalid(at(limitsPath, 'maxRadius'), 'maxRadius is below minRadius');
  }
  const inside = (key: keyof CameraHome, low: number, high: number): void => {
    if (home[key] < low || home[key] > high) {
      invalid(
        at(homePath, key),
        `home ${key} ${home[key]} is outside the limits ${low} to ${high}`,
      );
    }
  };
  inside('azimuth', limits.minAzimuth, limits.maxAzimuth);
  inside('elevation', limits.minElevation, limits.maxElevation);
  inside('radius', limits.minRadius, limits.maxRadius);
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

const NOTE_TOPICS: ReadonlySet<string> = new Set(Object.values(NoteTopic));

function readNotes(value: unknown, path: string): PartNote[] {
  if (value === undefined) {
    return [];
  }
  const notes = readArray(value, path).map((item, index) => {
    const notePath = at(path, index);
    const note = readObject(item, notePath);
    const topic = readName(note.topic, at(notePath, 'topic'));
    if (!NOTE_TOPICS.has(topic)) {
      return fail(
        PackErrorCode.invalidField,
        at(notePath, 'topic'),
        `unknown note topic ${topic}`,
      );
    }
    return {
      topic: topic as NoteTopic,
      text: readName(note.text, at(notePath, 'text')),
    };
  });
  if (new Set(notes.map(note => note.topic)).size !== notes.length) {
    return fail(PackErrorCode.invalidField, path, 'a note topic repeats');
  }
  return notes;
}

function readDirection(value: unknown, path: string) {
  if (value === undefined) return undefined;
  const object = readObject(value, path);
  return {
    azimuth: readNumber(object.azimuth, at(path, 'azimuth')),
    elevation: readNumber(object.elevation, at(path, 'elevation')),
  };
}

function readPart(value: unknown, path: string): Part {
  const object = readObject(value, path);
  const parent = object.parent;
  return {
    viewDirection: readDirection(
      object.viewDirection,
      at(path, 'viewDirection'),
    ),
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
    notes: readNotes(object.notes, at(path, 'notes')),
    bounds: readBounds(object.bounds, at(path, 'bounds')),
    anchor: readVec3(object.anchor, at(path, 'anchor')),
  };
}

function readStep(value: unknown, path: string): Step {
  const object = readObject(value, path);
  const partsPath = at(path, 'parts');
  return {
    id: readName(object.id, at(path, 'id')),
    viewDirection: readDirection(
      object.viewDirection,
      at(path, 'viewDirection'),
    ),
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
    if (procedure.id === TOUR_ID) {
      fail(
        PackErrorCode.reservedProcedureId,
        at(base, 'id'),
        `procedure id "${TOUR_ID}" is kept for the parts tour`,
      );
    }
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

function readChoice<T extends string>(
  value: unknown,
  path: string,
  choices: Readonly<Record<string, T>>,
): T {
  const text = readName(value, path);
  if (!(Object.values(choices) as string[]).includes(text)) {
    return fail(PackErrorCode.invalidField, path, `unknown value ${text}`);
  }
  return text as T;
}

function readEvidence(value: unknown, path: string): RelationEvidence {
  const object = readObject(value, path);
  const kind = readChoice(object.kind, at(path, 'kind'), EvidenceKind);
  const source = readName(object.source, at(path, 'source'));
  if (object.distance === undefined) {
    return { kind, source };
  }
  const distancePath = at(path, 'distance');
  if (kind !== EvidenceKind.measured) {
    return fail(
      PackErrorCode.invalidField,
      distancePath,
      'only measured evidence has a distance',
    );
  }
  const distance = readNumber(object.distance, distancePath);
  if (distance < 0) {
    return fail(
      PackErrorCode.invalidField,
      distancePath,
      'expected a non-negative distance',
    );
  }
  return { kind, source, distance };
}

function readRelation(value: unknown, path: string): Relation {
  const object = readObject(value, path);
  return {
    type: readChoice(object.type, at(path, 'type'), RelationType),
    from: readName(object.from, at(path, 'from')),
    to: readName(object.to, at(path, 'to')),
    evidence: readEvidence(object.evidence, at(path, 'evidence')),
  };
}

const relationKey = (type: string, from: PartId, to: PartId) =>
  JSON.stringify([type, from, to]);

function checkRelations(
  relations: readonly Relation[],
  parts: readonly Part[],
): void {
  const partIds = new Set(parts.map(part => part.id));
  const seen = new Set<string>();
  relations.forEach((relation, index) => {
    const base = at('relations', index);
    (['from', 'to'] as const).forEach(end => {
      if (!partIds.has(relation[end])) {
        fail(
          PackErrorCode.unknownRelationPart,
          at(base, end),
          `relation names unknown part "${relation[end]}"`,
        );
      }
    });
    if (relation.from === relation.to) {
      fail(
        PackErrorCode.selfRelation,
        at(base, 'to'),
        `part "${relation.from}" ${relation.type} itself`,
      );
    }
    const key = relationKey(relation.type, relation.from, relation.to);
    // Adjacency is symmetric, so its reverse would state the same fact twice.
    const reverse =
      relation.type === RelationType.adjacent &&
      seen.has(relationKey(relation.type, relation.to, relation.from));
    if (seen.has(key) || reverse) {
      fail(
        PackErrorCode.duplicateRelation,
        base,
        `"${relation.from}" ${relation.type} "${relation.to}" is stated twice`,
      );
    }
    seen.add(key);
  });
  const carried = new Map<PartId, PartId[]>();
  relations.forEach(relation => {
    if (
      relation.type === RelationType.carries ||
      relation.type === RelationType.supports
    ) {
      carried.set(relation.from, [
        ...(carried.get(relation.from) ?? []),
        relation.to,
      ]);
    }
  });
  // A kinematic chain cannot carry its own base: walk from each carried part back to its carrier.
  relations.forEach((relation, index) => {
    if (
      relation.type !== RelationType.carries &&
      relation.type !== RelationType.supports
    ) {
      return;
    }
    const walked = new Set<PartId>();
    const queue = [relation.to];
    while (queue.length > 0) {
      const next = queue.shift() as PartId;
      if (next === relation.from) {
        fail(
          PackErrorCode.carriesCycle,
          at('relations', index),
          `"${relation.from}" ends up carrying itself`,
        );
      }
      if (!walked.has(next)) {
        walked.add(next);
        queue.push(...(carried.get(next) ?? []));
      }
    }
  });
}

function readSpace(value: unknown, path: string): VectorSpace {
  const object = readObject(value, path);
  const dimensions = readCount(object.dimensions, at(path, 'dimensions'));
  if (dimensions === 0) {
    fail(
      PackErrorCode.invalidField,
      at(path, 'dimensions'),
      'expected at least one dimension',
    );
  }
  // Cosine ranking over the supplied rows assumes unit vectors from preparation.
  if (object.normalized !== true) {
    fail(
      PackErrorCode.invalidField,
      at(path, 'normalized'),
      'expected normalized vectors',
    );
  }
  return {
    id: readDigest(object.id, at(path, 'id')),
    encoder: readName(object.encoder, at(path, 'encoder')),
    weightsSha256: readDigest(object.weightsSha256, at(path, 'weightsSha256')),
    preprocessing: readName(object.preprocessing, at(path, 'preprocessing')),
    dimensions,
    normalized: true,
  };
}

function readVectorRow(value: unknown, path: string): VectorRow {
  const object = readObject(value, path);
  return {
    part: readName(object.part, at(path, 'part')),
    kind: readChoice(object.kind, at(path, 'kind'), VectorKind),
  };
}

function readSemantic(
  value: unknown,
  parts: readonly Part[],
): PackSemantic | undefined {
  if (value === undefined) {
    return undefined;
  }
  const path = 'semantic';
  const object = readObject(value, path);
  const space = readSpace(object.space, at(path, 'space'));
  const vectors = readFile(object.vectors, at(path, 'vectors'));
  const rowsPath = at(path, 'rows');
  const rows = readArray(object.rows, rowsPath).map((row, index) =>
    readVectorRow(row, at(rowsPath, index)),
  );
  if (rows.length === 0) {
    fail(PackErrorCode.invalidField, rowsPath, 'expected a row');
  }
  const partIds = new Set(parts.map(part => part.id));
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (!partIds.has(row.part)) {
      fail(
        PackErrorCode.unknownVectorPart,
        at(at(rowsPath, index), 'part'),
        `vector row names unknown part "${row.part}"`,
      );
    }
    const key = JSON.stringify([row.part, row.kind]);
    if (seen.has(key)) {
      fail(
        PackErrorCode.duplicateVectorRow,
        at(rowsPath, index),
        `part "${row.part}" has two ${row.kind} vectors`,
      );
    }
    seen.add(key);
  });
  if (vectors.bytes !== rows.length * space.dimensions * FLOAT32_BYTES) {
    fail(
      PackErrorCode.invalidField,
      at(at(path, 'vectors'), 'bytes'),
      'expected one float32 per dimension for every row',
    );
  }
  return { space, vectors, rows };
}

function buildPack(value: unknown): Pack {
  const root = readObject(value, '');
  const version = readNumber(root.schemaVersion, 'schemaVersion');
  if (version !== 2 && version !== SUPPORTED_SCHEMA_VERSION) {
    fail(
      PackErrorCode.unsupportedSchemaVersion,
      'schemaVersion',
      `schema version ${version} is not supported`,
    );
  }
  const packId = readName(root.packId, 'packId');
  // The ID is interpolated into a native bundle directory, so it must be one segment.
  if (!/^[a-zA-Z0-9_-]+$/.test(packId)) {
    fail(
      PackErrorCode.invalidField,
      'packId',
      'expected a pack directory name',
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
  const relations =
    root.relations === undefined
      ? []
      : readArray(root.relations, 'relations').map((relation, index) =>
          readRelation(relation, at('relations', index)),
        );
  checkRelations(relations, parts);
  const camera = readCamera(root.camera, 'camera');
  const checkDirection = (item: Part | Step, path: string) => {
    const direction = item.viewDirection;
    if (direction === undefined) {
      if (version === 3)
        fail(
          PackErrorCode.invalidField,
          path,
          'schema 3 requires a view direction',
        );
      return;
    }
    const { limits } = camera;
    if (
      direction.azimuth < limits.minAzimuth ||
      direction.azimuth > limits.maxAzimuth ||
      direction.elevation < limits.minElevation ||
      direction.elevation > limits.maxElevation
    ) {
      fail(
        PackErrorCode.invalidField,
        path,
        'view direction is outside camera limits',
      );
    }
  };
  parts.forEach((part, i) => checkDirection(part, `parts.${i}.viewDirection`));
  procedures.forEach((procedure, i) =>
    procedure.steps.forEach((step, j) =>
      checkDirection(step, `procedures.${i}.steps.${j}.viewDirection`),
    ),
  );

  return {
    schemaVersion: version,
    packId,
    packVersion: readCount(root.packVersion, 'packVersion'),
    title: readName(root.title, 'title'),
    sources: readSources(root.sources, parts),
    tiers,
    camera,
    parts,
    procedures: [tourOf({ parts, camera }), ...procedures],
    relations,
    model: root.model === undefined ? undefined : readFile(root.model, 'model'),
    semantic: readSemantic(root.semantic, parts),
  };
}
