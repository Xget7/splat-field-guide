import { parsePack } from '../parsePack';
import { fixtureCopy } from '@tests/fixturePack';

function prepared() {
  const manifest = fixtureCopy();
  manifest.schemaVersion = 3;
  const viewDirection = {
    azimuth: manifest.camera.home.azimuth,
    elevation: manifest.camera.home.elevation,
  };
  manifest.parts.forEach((part: any) => (part.viewDirection = viewDirection));
  manifest.procedures.forEach((procedure: any) =>
    procedure.steps.forEach(
      (step: any) => (step.viewDirection = viewDirection),
    ),
  );
  return manifest;
}

it('requires schema 3 directions and preserves tour and selection directions', () => {
  const manifest = prepared();
  const result = parsePack(manifest);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(
    result.pack.procedures[0].steps.every(step => step.viewDirection),
  ).toBe(true);
  delete manifest.parts[0].viewDirection;
  expect(parsePack(manifest).ok).toBe(false);
});

it('rejects missing step directions and out-of-limit directions', () => {
  const manifest = prepared();
  delete manifest.procedures[0].steps[0].viewDirection;
  expect(parsePack(manifest).ok).toBe(false);
  const outside = prepared();
  outside.parts[0].viewDirection.azimuth = outside.camera.limits.maxAzimuth + 1;
  expect(parsePack(outside).ok).toBe(false);
});

it('keeps legacy packs readable', () => {
  expect(parsePack(fixtureCopy()).ok).toBe(true);
});
