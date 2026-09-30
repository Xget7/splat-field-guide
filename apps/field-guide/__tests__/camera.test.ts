import {
  cameraLimitsInRadians,
  homeDirectionInRadians,
  boundsForView,
} from '../src/ui/camera';

test('all camera limit angles become radians, while radii remain in metres', () => {
  const limits = {
    minAzimuth: -180,
    maxAzimuth: 180,
    minElevation: -45,
    maxElevation: 90,
    minRadius: 0.25,
    maxRadius: 2.5,
  };
  expect(cameraLimitsInRadians(limits)).toEqual({
    minAzimuth: -Math.PI,
    maxAzimuth: Math.PI,
    minElevation: -Math.PI / 4,
    maxElevation: Math.PI / 2,
    minRadius: 0.25,
    maxRadius: 2.5,
  });
  expect(limits.minAzimuth).toBe(-180);
});

test('a range crossing pi is preserved rather than wrapping each endpoint', () => {
  const result = cameraLimitsInRadians({
    minAzimuth: 90,
    maxAzimuth: 270,
    minElevation: 0,
    maxElevation: 45,
    minRadius: 1,
    maxRadius: 2,
  });
  expect(result.minAzimuth).toBe(Math.PI / 2);
  expect(result.maxAzimuth).toBe((3 * Math.PI) / 2);
});

test('home framing converts both angles and excludes radius', () => {
  expect(
    homeDirectionInRadians({ azimuth: -90, elevation: 45, radius: 9 }),
  ).toEqual({ azimuth: -Math.PI / 2, elevation: Math.PI / 4 });
});

test('domain bounds map each axis into Nitro vector objects', () => {
  expect(boundsForView({ min: [-1, -2, -3], max: [4, 5, 6] })).toEqual({
    min: { x: -1, y: -2, z: -3 },
    max: { x: 4, y: 5, z: 6 },
  });
});
