import { fixtureCopy, fixturePack } from '@tests/fixturePack';
import {
  assemblyOf,
  chainThrough,
  feedPath,
  neighbours,
  RelationDirection,
  relationsOf,
} from '../graph';
import type { Pack } from '../pack';
import { parsePack } from '../parsePack';

const AUTHORED = { kind: 'authored', source: 'Drawing 12' };

function packWith(
  relations: readonly (readonly [string, string, string, object?])[],
): Pack {
  const manifest = fixtureCopy();
  manifest.relations = relations.map(([type, from, to, evidence]) => ({
    type,
    from,
    to,
    evidence: evidence ?? AUTHORED,
  }));
  const result = parsePack(manifest);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.pack;
}

const ids = (parts: readonly { id: string }[]) => parts.map(part => part.id);

describe('component graph', () => {
  it('lists the relations of a part from both ends with the other part resolved', () => {
    const pack = fixturePack();
    const [feeds] = relationsOf(pack, 'engine');
    expect(feeds.relation.type).toBe('feeds');
    expect(feeds.direction).toBe(RelationDirection.incoming);
    expect(feeds.other.name).toBe('Coolant reservoir');
    expect(feeds.relation.evidence.source).toBe('Workshop manual, cooling');
    expect(relationsOf(pack, 'coolant-reservoir')[0].direction).toBe(
      RelationDirection.outgoing,
    );
    expect(relationsOf(pack, 'fuse-box')).toEqual([]);
  });

  it('orders measured neighbours nearest first from either end', () => {
    const measured = (distance: number) => ({
      kind: 'measured',
      source: 'Lifted bounds',
      distance,
    });
    const pack = packWith([
      [
        'adjacent',
        'brake-fluid-reservoir',
        'power-steering-reservoir',
        measured(0.4),
      ],
      ['adjacent', 'battery', 'brake-fluid-reservoir', measured(0.1)],
      ['adjacent', 'brake-fluid-reservoir', 'fuse-box'],
      ['feeds', 'brake-fluid-reservoir', 'engine'],
    ]);
    expect(ids(neighbours(pack, 'brake-fluid-reservoir'))).toEqual([
      'battery',
      'power-steering-reservoir',
      'fuse-box',
    ]);
  });

  it('follows the carries chain from the root to the tip, ending at a branch', () => {
    const pack = packWith([
      ['carries', 'battery', 'fuse-box'],
      ['carries', 'fuse-box', 'engine'],
      ['carries', 'engine', 'valve-cover'],
      ['carries', 'engine', 'intake-manifold'],
    ]);
    expect(ids(chainThrough(pack, 'valve-cover'))).toEqual([
      'battery',
      'fuse-box',
      'engine',
      'valve-cover',
    ]);
    expect(ids(chainThrough(pack, 'battery'))).toEqual([
      'battery',
      'fuse-box',
      'engine',
    ]);
    expect(ids(chainThrough(pack, 'coolant-reservoir'))).toEqual([
      'coolant-reservoir',
    ]);
    expect(chainThrough(pack, 'horn')).toEqual([]);
  });

  it('keeps stationary support distinct while following the mechanical chain', () => {
    const pack = packWith([
      ['supports', 'battery', 'engine'],
      ['carries', 'engine', 'valve-cover'],
    ]);
    expect(ids(chainThrough(pack, 'valve-cover'))).toEqual([
      'battery',
      'engine',
      'valve-cover',
    ]);
    expect(relationsOf(pack, 'battery')[0].relation.type).toBe('supports');
    const manifest = fixtureCopy();
    manifest.relations = [
      {
        type: 'supports',
        from: 'engine',
        to: 'valve-cover',
        evidence: AUTHORED,
      },
      {
        type: 'carries',
        from: 'valve-cover',
        to: 'engine',
        evidence: AUTHORED,
      },
    ];
    expect(parsePack(manifest).ok).toBe(false);
  });

  it('walks feeds upstream in flow order and downstream, surviving a loop', () => {
    const pack = packWith([
      ['feeds', 'power-steering-reservoir', 'coolant-reservoir'],
      ['feeds', 'coolant-reservoir', 'engine'],
      ['feeds', 'engine', 'valve-cover'],
      ['feeds', 'valve-cover', 'coolant-reservoir'],
    ]);
    const path = feedPath(pack, 'engine');
    expect(ids(path.upstream)).toEqual([
      'power-steering-reservoir',
      'valve-cover',
      'coolant-reservoir',
    ]);
    expect(ids(path.downstream)).toEqual(['valve-cover', 'coolant-reservoir']);
  });

  it('finds the top-level assembly of a part', () => {
    const pack = fixturePack();
    expect(assemblyOf(pack, 'valve-cover')?.id).toBe('engine');
    expect(assemblyOf(pack, 'battery')?.id).toBe('battery');
    expect(assemblyOf(pack, 'horn')).toBeUndefined();
  });
});
