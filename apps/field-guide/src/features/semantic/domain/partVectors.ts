import type {
  PackSemantic,
  PartId,
  VectorKind,
  VectorSpace,
} from '../../pack/pack';

const FLOAT32_BYTES = 4;

export interface VectorQuery {
  /** The space the query vector was encoded in; it must equal the pack's space id. */
  readonly spaceId: string;
  readonly vector: Float32Array;
}

export interface PartMatch {
  readonly partId: PartId;
  /** Cosine similarity, from -1 to 1. */
  readonly score: number;
}

export const VectorErrorCode = {
  /** The vector file holds a different number of bytes than the manifest states. */
  vectorsLength: 'vectorsLength',
  /** The vector file holds a value that is not a finite number. */
  invalidVectors: 'invalidVectors',
  /** The query comes from another encoder, preprocessing or weights. */
  spaceMismatch: 'spaceMismatch',
  queryLength: 'queryLength',
  /** The query has a non-finite value or no direction to compare. */
  invalidQuery: 'invalidQuery',
} as const;
export type VectorErrorCode =
  (typeof VectorErrorCode)[keyof typeof VectorErrorCode];

export interface VectorError {
  readonly code: VectorErrorCode;
  readonly message: string;
}

export type RankResult =
  | { readonly ok: true; readonly matches: readonly PartMatch[] }
  | { readonly ok: false; readonly error: VectorError };

export interface PartVectorIndex {
  readonly space: VectorSpace;
  /** The parts whose supplied vector of `kind` is closest to the query, best first. */
  rankParts(query: VectorQuery, kind: VectorKind, limit: number): RankResult;
  /** Uses an existing prepared row as the query; never encodes text on the phone. */
  similarParts(partId: PartId, kind: VectorKind, limit: number): RankResult;
}

export type OpenResult =
  | { readonly ok: true; readonly index: PartVectorIndex }
  | { readonly ok: false; readonly error: VectorError };

const failure = (code: VectorErrorCode, message: string) =>
  ({ ok: false, error: { code, message } } as const);

function normOf(values: Float32Array, start: number, length: number): number {
  let sum = 0;
  for (let i = start; i < start + length; i += 1) {
    sum += values[i] * values[i];
  }
  return Math.sqrt(sum);
}

/**
 * Opens supplied part vectors for comparison. `vectors` is either the file's bytes,
 * read as little-endian float32 whatever the device order, or already decoded values.
 */
export function openPartVectorIndex(
  semantic: PackSemantic,
  vectors: ArrayBuffer | Float32Array,
): OpenResult {
  const { space, rows } = semantic;
  const byteLength =
    vectors instanceof Float32Array
      ? vectors.length * FLOAT32_BYTES
      : vectors.byteLength;
  if (
    byteLength !== semantic.vectors.bytes ||
    byteLength !== rows.length * space.dimensions * FLOAT32_BYTES
  ) {
    return failure(
      VectorErrorCode.vectorsLength,
      `expected ${semantic.vectors.bytes} vector bytes, got ${byteLength}`,
    );
  }
  let values: Float32Array;
  if (vectors instanceof Float32Array) {
    values = vectors;
  } else {
    const view = new DataView(vectors);
    values = new Float32Array(byteLength / FLOAT32_BYTES);
    for (let i = 0; i < values.length; i += 1) {
      values[i] = view.getFloat32(i * FLOAT32_BYTES, true);
    }
  }
  if (!values.every(Number.isFinite)) {
    return failure(
      VectorErrorCode.invalidVectors,
      'a supplied vector is not finite',
    );
  }
  const norms = rows.map((_row, index) =>
    normOf(values, index * space.dimensions, space.dimensions),
  );

  function rankParts(
    query: VectorQuery,
    kind: VectorKind,
    limit: number,
  ): RankResult {
    // Equal dimensions do not make two encoders comparable, so identity decides first.
    if (query.spaceId !== space.id) {
      return failure(
        VectorErrorCode.spaceMismatch,
        `query space ${query.spaceId} is not the pack space ${space.id}`,
      );
    }
    if (query.vector.length !== space.dimensions) {
      return failure(
        VectorErrorCode.queryLength,
        `expected ${space.dimensions} dimensions, got ${query.vector.length}`,
      );
    }
    const queryNorm = normOf(query.vector, 0, space.dimensions);
    if (!Number.isFinite(queryNorm) || queryNorm === 0) {
      return failure(
        VectorErrorCode.invalidQuery,
        'the query vector has no finite direction',
      );
    }
    const matches = rows.flatMap((row, index) => {
      if (row.kind !== kind) {
        return [];
      }
      const start = index * space.dimensions;
      let dot = 0;
      for (let i = 0; i < space.dimensions; i += 1) {
        dot += query.vector[i] * values[start + i];
      }
      const scale = queryNorm * norms[index];
      return [{ partId: row.part, score: scale === 0 ? 0 : dot / scale }];
    });
    // The sort is stable, so equal scores keep the manifest's row order.
    matches.sort((a, b) => b.score - a.score);
    return { ok: true, matches: matches.slice(0, Math.max(0, limit)) };
  }

  return {
    ok: true,
    index: {
      space,
      rankParts,
      similarParts(partId, kind, limit) {
        const row = rows.findIndex(
          item => item.part === partId && item.kind === kind,
        );
        if (row < 0)
          return failure(
            VectorErrorCode.invalidQuery,
            'No prepared vector exists for that component and kind',
          );
        const ranked = rankParts(
          {
            spaceId: space.id,
            vector: values.slice(
              row * space.dimensions,
              (row + 1) * space.dimensions,
            ),
          },
          kind,
          limit + 1,
        );
        return ranked.ok
          ? {
              ok: true,
              matches: ranked.matches
                .filter(match => match.partId !== partId)
                .slice(0, Math.max(0, limit)),
            }
          : ranked;
      },
    },
  };
}
