import { PART_LABEL_MAX, PART_LABEL_MIN } from '../pack';
import { PackErrorCode, parsePack } from '../parsePack';
import { fixtureCopy, fixtureManifest } from '../testing/fixturePack';

function errorOf(mutate: (manifest: Record<string, any>) => void) {
  const manifest = fixtureCopy();
  mutate(manifest);
  const result = parsePack(manifest);
  if (result.ok) {
    throw new Error('expected the pack to be refused');
  }
  return result.error;
}

describe('parsePack', () => {
  it('accepts the fixture and keeps its parts and procedures', () => {
    const result = parsePack(fixtureManifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.parts).toHaveLength(8);
      expect(result.pack.procedures).toHaveLength(3);
      expect(result.pack.parts[6].parent).toBe('engine');
    }
  });

  it('defaults optional fields', () => {
    const manifest = fixtureCopy();
    delete manifest.parts[0].aliases;
    delete manifest.parts[0].details;
    delete manifest.procedures[0].steps[0].caution;
    const result = parsePack(manifest);
    expect(result.ok && result.pack.parts[0].aliases).toEqual([]);
    expect(result.ok && result.pack.procedures[0].steps[0].caution).toBe('');
  });

  it.each([null, 'pack', 3, [], undefined])('refuses %p as a manifest', v => {
    const result = parsePack(v);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe(PackErrorCode.invalidField);
  });

  it('refuses an unknown schema version', () => {
    const error = errorOf(m => (m.schemaVersion = 2));
    expect(error.code).toBe(PackErrorCode.unsupportedSchemaVersion);
    expect(error.path).toBe('schemaVersion');
  });

  it('checks the schema version before anything else', () => {
    const error = errorOf(m => {
      m.schemaVersion = 99;
      m.parts = 'nonsense';
    });
    expect(error.code).toBe(PackErrorCode.unsupportedSchemaVersion);
  });

  it('refuses a missing schema version', () => {
    const error = errorOf(m => delete m.schemaVersion);
    expect(error.code).toBe(PackErrorCode.invalidField);
  });

  it('refuses duplicate part ids', () => {
    const error = errorOf(m => (m.parts[1].id = 'coolant-reservoir'));
    expect(error.code).toBe(PackErrorCode.duplicatePartId);
    expect(error.path).toBe('parts[1].id');
  });

  it('refuses duplicate part labels', () => {
    const error = errorOf(m => (m.parts[1].label = 1));
    expect(error.code).toBe(PackErrorCode.duplicatePartLabel);
    expect(error.path).toBe('parts[1].label');
  });

  it.each([PART_LABEL_MIN - 1, PART_LABEL_MAX + 1, 1.5, -3])(
    'refuses label %p outside the label range',
    label => {
      const error = errorOf(m => (m.parts[0].label = label));
      expect(error.code).toBe(PackErrorCode.labelOutOfRange);
    },
  );

  it.each([PART_LABEL_MIN, PART_LABEL_MAX])('accepts label %p', label => {
    const manifest = fixtureCopy();
    manifest.parts[0].label = label;
    expect(parsePack(manifest).ok).toBe(true);
  });

  it('refuses a label that is not a number', () => {
    const error = errorOf(m => (m.parts[0].label = '3'));
    expect(error.code).toBe(PackErrorCode.invalidField);
  });

  it('refuses a parent that does not exist', () => {
    const error = errorOf(m => (m.parts[6].parent = 'motor'));
    expect(error.code).toBe(PackErrorCode.unknownParent);
    expect(error.path).toBe('parts[6].parent');
  });

  it('refuses a part that is its own parent', () => {
    const error = errorOf(m => (m.parts[5].parent = 'engine'));
    expect(error.code).toBe(PackErrorCode.parentCycle);
  });

  it('refuses a longer parent cycle', () => {
    const error = errorOf(m => (m.parts[5].parent = 'intake-manifold'));
    expect(error.code).toBe(PackErrorCode.parentCycle);
  });

  it('accepts parts nested more than one level deep', () => {
    const manifest = fixtureCopy();
    manifest.parts[0].parent = 'valve-cover';
    expect(parsePack(manifest).ok).toBe(true);
  });

  it('refuses a step naming an unknown part', () => {
    const error = errorOf(m => (m.procedures[1].steps[0].parts = ['horn']));
    expect(error.code).toBe(PackErrorCode.unknownStepPart);
    expect(error.path).toBe('procedures[1].steps[0].parts[0]');
  });

  it('refuses duplicate procedure ids', () => {
    const error = errorOf(m => (m.procedures[1].id = 'check-coolant'));
    expect(error.code).toBe(PackErrorCode.duplicateProcedureId);
  });

  it('refuses duplicate step ids inside a procedure', () => {
    const error = errorOf(m => (m.procedures[0].steps[1].id = 'engine-cold'));
    expect(error.code).toBe(PackErrorCode.duplicateStepId);
  });

  it('refuses a procedure without steps', () => {
    const error = errorOf(m => (m.procedures[0].steps = []));
    expect(error.code).toBe(PackErrorCode.invalidField);
    expect(error.path).toBe('procedures[0].steps');
  });

  it('refuses a pack without tiers', () => {
    const error = errorOf(m => (m.tiers = []));
    expect(error.path).toBe('tiers');
  });

  it.each([
    [
      'an empty part name',
      (m: any) => (m.parts[0].name = ' '),
      'parts[0].name',
    ],
    [
      'bounds with min above max',
      (m: any) => (m.parts[0].bounds.min = [5, 5, 5]),
      'parts[0].bounds',
    ],
    [
      'an anchor with two numbers',
      (m: any) => (m.parts[0].anchor = [1, 2]),
      'parts[0].anchor',
    ],
    [
      'a non-finite bound',
      (m: any) => (m.parts[0].bounds.max = [1, 1, null]),
      'parts[0].bounds.max[2]',
    ],
    [
      'a non-string alias',
      (m: any) => (m.parts[0].aliases = [4]),
      'parts[0].aliases[0]',
    ],
    [
      'aliases that are not a list',
      (m: any) => (m.parts[0].aliases = 'tank'),
      'parts[0].aliases',
    ],
    [
      'a fractional splat count',
      (m: any) => (m.tiers[0].splatCount = 1.5),
      'tiers[0].splatCount',
    ],
    [
      'a missing tier file',
      (m: any) => delete m.tiers[0].cloud,
      'tiers[0].cloud',
    ],
    [
      'a missing camera limit',
      (m: any) => delete m.camera.limits.minRadius,
      'camera.limits.minRadius',
    ],
    ['a missing camera home', (m: any) => delete m.camera.home, 'camera.home'],
    [
      'a non-object procedure',
      (m: any) => (m.procedures[0] = 7),
      'procedures[0]',
    ],
    [
      'a non-string step text',
      (m: any) => (m.procedures[0].steps[0].text = 1),
      'procedures[0].steps[0].text',
    ],
    ['a missing pack title', (m: any) => delete m.title, 'title'],
    [
      'a non-integer pack version',
      (m: any) => (m.packVersion = 'x'),
      'packVersion',
    ],
  ])('refuses %s', (_name, mutate, path) => {
    const error = errorOf(mutate);
    expect(error.code).toBe(PackErrorCode.invalidField);
    expect(error.path).toBe(path);
  });
});
