import { Pack, Part, Procedure, ProcedureId, Step } from '../pack/pack';

/** Reserved: an authored procedure may not take it. */
export const TOUR_ID: ProcedureId = 'tour';
export const TOUR_TITLE = 'Parts tour';

const RADIANS_PER_DEGREE = Math.PI / 180;

/** Order parts left to right in the home view so the tour moves one way across the equipment. */
export function tourOf(pack: Pick<Pack, 'parts' | 'camera'>): Procedure {
  const azimuth = pack.camera.home.azimuth * RADIANS_PER_DEGREE;
  // The home camera's right: +X turned about +Y by its azimuth.
  const across = (part: Part) =>
    part.anchor[0] * Math.cos(azimuth) - part.anchor[2] * Math.sin(azimuth);
  const steps: Step[] = [...pack.parts]
    .sort((a, b) => across(a) - across(b))
    .map(part => ({
      id: part.id,
      text: part.summary,
      parts: [part.id],
      caution: '',
    }));
  return { id: TOUR_ID, title: TOUR_TITLE, steps };
}
