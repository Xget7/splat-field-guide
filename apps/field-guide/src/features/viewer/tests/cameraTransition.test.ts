import {
  CUT_DEGREES,
  MAX_TURN_DEGREES_PER_SECOND,
  MIN_MOVE_SECONDS,
  transitionBetween,
} from '../domain/camera';

const RADIANS_PER_DEGREE = Math.PI / 180;
const direction = (azimuth: number, elevation = 20) => ({
  azimuth: azimuth * RADIANS_PER_DEGREE,
  elevation: elevation * RADIANS_PER_DEGREE,
});
const MEDIUM_TURN = 84;

test('a small turn still takes the minimum time', () => {
  expect(transitionBetween(direction(10), direction(20), false)).toEqual({
    kind: 'move',
    seconds: MIN_MOVE_SECONDS,
  });
});

test('a medium turn is capped at a comfortable turning speed', () => {
  const transition = transitionBetween(
    direction(0),
    direction(MEDIUM_TURN),
    false,
  );
  expect(transition.kind).toBe('move');
  expect(transition.kind === 'move' && transition.seconds).toBeCloseTo(
    MEDIUM_TURN / MAX_TURN_DEGREES_PER_SECOND,
  );
});

test('a swing past the cut angle cuts instead of whipping around', () => {
  expect(
    transitionBetween(direction(0), direction(CUT_DEGREES + 1), false),
  ).toEqual({ kind: 'cut' });
});

test('reduced motion always cuts', () => {
  expect(transitionBetween(direction(10), direction(20), true)).toEqual({
    kind: 'cut',
  });
});
