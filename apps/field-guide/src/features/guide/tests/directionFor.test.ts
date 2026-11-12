import { directionFor } from '../domain/derive';
import { parsePack } from '../../pack/parsePack';
import { fixtureCopy } from '@tests/fixturePack';

it('uses selected part before step and falls back to home for legacy packs', () => {
  const manifest = fixtureCopy();
  const stepDirection = {
    azimuth: manifest.camera.home.azimuth,
    elevation: manifest.camera.home.elevation,
  };
  const partDirection = {
    ...stepDirection,
    azimuth: manifest.camera.limits.minAzimuth,
  };
  manifest.parts[0].viewDirection = partDirection;
  manifest.procedures[0].steps[0].viewDirection = stepDirection;
  const parsed = parsePack(manifest);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const pack = parsed.pack;
  const state = {
    procedureId: pack.procedures[1].id,
    stepIndex: 0,
    selectedPart: null,
  };
  expect(directionFor(state, pack)).toEqual(stepDirection);
  expect(
    directionFor({ ...state, selectedPart: pack.parts[0].id }, pack),
  ).toEqual(partDirection);
  expect(
    directionFor({ ...state, selectedPart: pack.parts[1].id }, pack),
  ).toEqual(pack.camera.home);
});
