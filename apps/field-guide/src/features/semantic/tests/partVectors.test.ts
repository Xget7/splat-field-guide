import { FIXTURE_DIMENSIONS, fixturePack } from '@tests/fixturePack';
import { VectorKind } from '../../pack/pack';
import { openPartVectorIndex, VectorErrorCode } from '../index';

const semantic = fixturePack().semantic!;
const SPACE_ID = semantic.space.id;
// Rows in fixture order: battery image, engine image, battery text.
const ROWS = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];

function fileBytes(rows: readonly (readonly number[])[]): ArrayBuffer {
  const buffer = new ArrayBuffer(rows.length * FIXTURE_DIMENSIONS * 4);
  const view = new DataView(buffer);
  rows
    .flat()
    .forEach((value, index) => view.setFloat32(index * 4, value, true));
  return buffer;
}

function open(vectors: ArrayBuffer | Float32Array = fileBytes(ROWS)) {
  const result = openPartVectorIndex(semantic, vectors);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.index;
}

const query = (values: number[], spaceId = SPACE_ID) => ({
  spaceId,
  vector: new Float32Array(values),
});

describe('supplied part vectors', () => {
  it('ranks parts of the asked kind by cosine, returning stable part ids', () => {
    const result = open().rankParts(
      query([0.6, 0.8, 0.9, 0]),
      VectorKind.image,
      5,
    );
    expect(result.ok && result.matches.map(m => m.partId)).toEqual([
      'engine',
      'battery',
    ]);
    expect(result.ok && result.matches[0].score).toBeCloseTo(
      0.8 / Math.sqrt(1.81),
      5,
    );
    const text = open().rankParts(query([0, 0, 2, 0]), VectorKind.text, 1);
    expect(text.ok && text.matches).toEqual([{ partId: 'battery', score: 1 }]);
  });

  it('reads the file as little-endian bytes and accepts decoded values alike', () => {
    const decoded = new Float32Array(ROWS.flat());
    const ask = query([1, 0, 0, 0]);
    expect(open(decoded).rankParts(ask, VectorKind.image, 1)).toEqual(
      open().rankParts(ask, VectorKind.image, 1),
    );
  });

  it('refuses a query from another space even when the dimensions match', () => {
    const result = open().rankParts(
      query([1, 0, 0, 0], 'a'.repeat(64)),
      VectorKind.image,
      3,
    );
    expect(!result.ok && result.error.code).toBe(VectorErrorCode.spaceMismatch);
  });

  it.each([
    [[1, 0, 0], VectorErrorCode.queryLength],
    [[0, 0, 0, 0], VectorErrorCode.invalidQuery],
    [[NaN, 0, 0, 0], VectorErrorCode.invalidQuery],
  ])('refuses the query %p', (values, code) => {
    const result = open().rankParts(query(values), VectorKind.image, 3);
    expect(!result.ok && result.error.code).toBe(code);
  });

  it('refuses vector bytes that disagree with the manifest', () => {
    const short = openPartVectorIndex(semantic, fileBytes(ROWS.slice(0, 2)));
    expect(!short.ok && short.error.code).toBe(VectorErrorCode.vectorsLength);
    const broken = openPartVectorIndex(
      semantic,
      fileBytes([[Infinity, 0, 0, 0], ...ROWS.slice(1)]),
    );
    expect(!broken.ok && broken.error.code).toBe(
      VectorErrorCode.invalidVectors,
    );
  });
});

test('similarity queries use a supplied component row and exclude that component itself', () => {
  const index = open();
  expect(index.similarParts('battery', VectorKind.image, 3)).toEqual({
    ok: true,
    matches: [{ partId: 'engine', score: 0 }],
  });
  expect(index.similarParts('engine', VectorKind.text, 3).ok).toBe(false);
});
