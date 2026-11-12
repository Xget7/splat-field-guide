import {
  HIGHLIGHT_FALLBACK_TINT,
  HIGHLIGHT_OTHER_BRIGHTNESS,
  highlightLookFor,
} from '../domain/highlightLook';

const ORANGE_ARM = '#e8740c';
const BLACK_MOTOR = '#141414';
const WHITE_PEDESTAL = '#e6e6e6';
const LIGHT = 0.6;
const DEEP = 0.4;

function channels(rgb: number) {
  const hex = rgb.toString(16).padStart(6, '0');
  const [r, g, b] = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16));
  return { r, g, b };
}

function lightness(rgb: number) {
  const { r, g, b } = channels(rgb);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

describe('highlight look', () => {
  test('tints an orange part blue', () => {
    const { r, g, b } = channels(
      highlightLookFor({ color: ORANGE_ARM }).tintRgb,
    );
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  test('tints a black part light and a white part deep', () => {
    expect(
      lightness(highlightLookFor({ color: BLACK_MOTOR }).tintRgb),
    ).toBeGreaterThan(LIGHT);
    expect(
      lightness(highlightLookFor({ color: WHITE_PEDESTAL }).tintRgb),
    ).toBeLessThan(DEEP);
  });

  test('keeps the navy for a part without a measured colour', () => {
    expect(highlightLookFor({}).tintRgb).toBe(HIGHLIGHT_FALLBACK_TINT);
  });

  test('dims the scene only while something is highlighted', () => {
    expect(highlightLookFor({}).otherBrightness).toBe(
      HIGHLIGHT_OTHER_BRIGHTNESS,
    );
    expect(highlightLookFor(null).otherBrightness).toBe(1);
  });
});
