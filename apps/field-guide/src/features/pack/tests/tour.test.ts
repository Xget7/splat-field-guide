import { fixturePack } from '@tests/fixturePack';
import { TOUR_ID, TOUR_TITLE, tourOf } from '../tour';

const pack = fixturePack();
const tour = tourOf(pack);

// Only the tour reads it, so the home may leave the limits here.
const seenFrom = (azimuth: number) => ({
  parts: pack.parts,
  camera: { ...pack.camera, home: { ...pack.camera.home, azimuth } },
});

describe('tourOf', () => {
  it('visits every part once, one part per step, told by its summary', () => {
    expect(tour.id).toBe(TOUR_ID);
    expect(tour.title).toBe(TOUR_TITLE);
    expect(tour.steps.map(step => step.id).sort()).toEqual(
      pack.parts.map(part => part.id).sort(),
    );
    tour.steps.forEach(step => {
      const part = pack.parts.find(p => p.id === step.id);
      expect(step.parts).toEqual([step.id]);
      expect(step.text).toBe(part?.summary);
      expect(step.caution).toBe('');
    });
  });

  it('orders machines left to right while keeping their parts with them', () => {
    // Home at azimuth 0 looks down -Z, so left to right is +X; ties keep the manifest's order.
    expect(tour.steps.map(step => step.id)).toEqual([
      'coolant-reservoir',
      'power-steering-reservoir',
      'brake-fluid-reservoir',
      'battery',
      'fuse-box',
      'engine',
      'valve-cover',
      'intake-manifold',
    ]);
    const fromBehind = tourOf(seenFrom(180)).steps.map(step => step.id);
    expect(fromBehind.slice(0, 3)).toEqual([
      'engine',
      'valve-cover',
      'intake-manifold',
    ]);
    expect(fromBehind[fromBehind.length - 1]).toBe('coolant-reservoir');
  });

  it('introduces each machine before its parts and never interleaves another machine', () => {
    const reference = pack.parts[0];
    const parts = [
      {
        ...reference,
        id: 'roof-base',
        parent: 'roof',
        anchor: [0, 0, 0] as const,
      },
      {
        ...reference,
        id: 'rear-housing',
        parent: 'rear',
        anchor: [1, 0, 0] as const,
      },
      {
        ...reference,
        id: 'roof-column',
        parent: 'roof',
        anchor: [2, 0, 0] as const,
      },
      { ...reference, id: 'roof', parent: null, anchor: [0, 0, 0] as const },
      { ...reference, id: 'rear', parent: null, anchor: [1, 0, 0] as const },
    ];
    expect(tourOf({ ...pack, parts }).steps.map(step => step.id)).toEqual([
      'roof',
      'roof-base',
      'roof-column',
      'rear',
      'rear-housing',
    ]);
  });

  it('follows supplied support and carries links within a machine without following proximity into another one', () => {
    const reference = pack.parts[0];
    const parts = [
      { ...reference, id: 'tool', parent: 'roof' },
      { ...reference, id: 'arm', parent: 'roof' },
      { ...reference, id: 'base', parent: 'roof' },
      { ...reference, id: 'roof', parent: null },
      { ...reference, id: 'rear', parent: null },
    ];
    const evidence = { kind: 'authored' as const, source: 'Example chain' };
    const relations = [
      { type: 'supports' as const, from: 'base', to: 'arm', evidence },
      { type: 'carries' as const, from: 'arm', to: 'tool', evidence },
      { type: 'adjacent' as const, from: 'arm', to: 'rear', evidence },
    ];
    expect(
      tourOf({ ...pack, parts, relations }).steps.map(step => step.id),
    ).toEqual(['roof', 'base', 'arm', 'tool', 'rear']);
  });

  it('is for operators and authors no objective', () => {
    expect(tour.audience).toBe('operator');
    expect('objective' in tour).toBe(false);
  });

  it('is the first procedure of a parsed pack', () => {
    expect(pack.procedures[0]).toEqual(tour);
  });
});
