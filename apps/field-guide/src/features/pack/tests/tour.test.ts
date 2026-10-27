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

  it('orders the parts left to right as the home camera sees them', () => {
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
    expect(fromBehind[0]).toBe('intake-manifold');
    expect(fromBehind[fromBehind.length - 1]).toBe('coolant-reservoir');
  });

  it('is the first procedure of a parsed pack', () => {
    expect(pack.procedures[0]).toEqual(tour);
  });
});
