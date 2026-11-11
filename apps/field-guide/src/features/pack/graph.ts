import {
  EvidenceKind,
  RelationType,
  type Pack,
  type Part,
  type PartId,
  type Relation,
} from './pack';

// Navigation over the supplied relations and the parent hierarchy. Every function accepts
// hand-built packs too, so walks keep a visited set even where parsing forbids cycles.

export const RelationDirection = {
  /** The part is the relation's subject, as in "the arm carries the wrist". */
  outgoing: 'outgoing',
  /** The part is the relation's object, as in "the wrist is carried by the arm". */
  incoming: 'incoming',
} as const;
export type RelationDirection =
  (typeof RelationDirection)[keyof typeof RelationDirection];

export interface PartRelation {
  readonly relation: Relation;
  readonly direction: RelationDirection;
  /** The part at the relation's other end. */
  readonly other: Part;
}

/** Ordered with the flow: `[...upstream, part, ...downstream]` reads from source to consumer. */
export interface FeedPath {
  readonly upstream: readonly Part[];
  readonly downstream: readonly Part[];
}

function partsById(pack: Pack): ReadonlyMap<PartId, Part> {
  return new Map(pack.parts.map(part => [part.id, part]));
}

/** Every relation the part takes part in, in manifest order, with the other part resolved. */
export function relationsOf(
  pack: Pack,
  partId: PartId,
): readonly PartRelation[] {
  const parts = partsById(pack);
  return pack.relations.flatMap(relation => {
    const end =
      relation.from === partId
        ? { direction: RelationDirection.outgoing, other: relation.to }
        : relation.to === partId
        ? { direction: RelationDirection.incoming, other: relation.from }
        : null;
    const other = end && parts.get(end.other);
    return end && other ? [{ relation, direction: end.direction, other }] : [];
  });
}

/** A relation's measured gap; an unmeasured or authored relation sorts after every measured one. */
export const measuredDistance = (relation: Relation): number =>
  relation.evidence.kind === EvidenceKind.measured
    ? relation.evidence.distance ?? Infinity
    : Infinity;

/** Parts measured adjacent to this one, nearest first; unmeasured gaps keep manifest order last. */
export function neighbours(pack: Pack, partId: PartId): readonly Part[] {
  return relationsOf(pack, partId)
    .filter(({ relation }) => relation.type === RelationType.adjacent)
    .sort((a, b) => measuredDistance(a.relation) - measuredDistance(b.relation))
    .map(({ other }) => other);
}

function linked(
  pack: Pack,
  type: RelationType,
  partId: PartId,
  direction: RelationDirection,
): PartId[] {
  return pack.relations
    .filter(relation => relation.type === type)
    .filter(relation =>
      direction === RelationDirection.outgoing
        ? relation.from === partId
        : relation.to === partId,
    )
    .map(relation =>
      direction === RelationDirection.outgoing ? relation.to : relation.from,
    );
}

/**
 * The kinematic chain through the part, from the carrying root to the tip.
 * Upwards it follows the first carrier in manifest order; downwards it continues while each
 * link carries exactly one part, so a branch ends the chain instead of choosing a side.
 */
export function chainThrough(pack: Pack, partId: PartId): readonly Part[] {
  const parts = partsById(pack);
  if (!parts.has(partId)) {
    return [];
  }
  const chain: PartId[] = [partId];
  const seen = new Set<PartId>(chain);
  for (
    let carrier = linked(
      pack,
      RelationType.carries,
      partId,
      RelationDirection.incoming,
    )[0];
    carrier !== undefined && !seen.has(carrier);
    carrier = linked(
      pack,
      RelationType.carries,
      carrier,
      RelationDirection.incoming,
    )[0]
  ) {
    chain.unshift(carrier);
    seen.add(carrier);
  }
  for (let tip = partId; ; ) {
    const carried = linked(
      pack,
      RelationType.carries,
      tip,
      RelationDirection.outgoing,
    );
    if (carried.length !== 1 || seen.has(carried[0])) {
      break;
    }
    tip = carried[0];
    chain.push(tip);
    seen.add(tip);
  }
  return chain.map(id => parts.get(id) as Part);
}

/** Parts reached along `feeds`, grouped by hops from the part, each group in manifest order. */
function feedLevels(
  pack: Pack,
  partId: PartId,
  direction: RelationDirection,
): PartId[][] {
  const levels: PartId[][] = [];
  const seen = new Set<PartId>([partId]);
  for (let frontier = [partId]; frontier.length > 0; ) {
    const level: PartId[] = [];
    for (const current of frontier) {
      for (const next of linked(pack, RelationType.feeds, current, direction)) {
        if (!seen.has(next)) {
          seen.add(next);
          level.push(next);
        }
      }
    }
    if (level.length > 0) {
      levels.push(level);
    }
    frontier = level;
  }
  return levels;
}

/** Everything that feeds the part, directly or through others, and everything it feeds. */
export function feedPath(pack: Pack, partId: PartId): FeedPath {
  const parts = partsById(pack);
  const resolve = (levels: readonly PartId[][]) =>
    levels.flat().flatMap(id => parts.get(id) ?? []);
  return {
    // The flow starts at the farthest supplier, so upstream groups run farthest first.
    upstream: resolve(
      feedLevels(pack, partId, RelationDirection.incoming).reverse(),
    ),
    downstream: resolve(feedLevels(pack, partId, RelationDirection.outgoing)),
  };
}

/** The top-level assembly containing the part, such as a whole robot; a top-level part is its own. */
export function assemblyOf(pack: Pack, partId: PartId): Part | undefined {
  const parts = partsById(pack);
  let part = parts.get(partId);
  const seen = new Set<PartId>();
  while (part?.parent && !seen.has(part.id)) {
    seen.add(part.id);
    part = parts.get(part.parent) ?? part;
  }
  return part;
}
