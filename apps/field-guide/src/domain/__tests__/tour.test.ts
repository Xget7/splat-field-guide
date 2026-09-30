import { framingFor, highlightFor } from '../derive';
import {
  currentStep,
  INITIAL_SESSION,
  reduce,
  SessionEventType,
} from '../session';
import { fixturePack } from '../testing/fixturePack';
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

  it('runs as a procedure: each step frames and highlights its part and what is inside', () => {
    let state = reduce(
      INITIAL_SESSION,
      { type: SessionEventType.start, procedureId: TOUR_ID },
      pack,
    );
    const seen: string[] = [];
    for (let i = 0; i < tour.steps.length; i++) {
      const step = currentStep(state, pack);
      seen.push(step?.id ?? '');
      if (step?.id === 'engine') {
        expect(highlightFor(state, pack)).toEqual([6, 7, 8]);
        expect(framingFor(state, pack)).toEqual({
          min: [10, 0, 0],
          max: [14, 3, 3],
        });
      }
      state = reduce(state, { type: SessionEventType.next }, pack);
    }
    expect(seen).toEqual(tour.steps.map(step => step.id));
  });
});
