import {
  HIGHLIGHT_FALLBACK_TINT,
  HIGHLIGHT_OTHER_BRIGHTNESS,
  highlightLookFor,
} from '../domain/highlightLook';

// Measured on the Miris arms: a deep orange and a strongly saturated link arm.
const MEASURED_ORANGES = ['#986440', '#a9511a', '#bf7131'];
const BLACK_MOTOR = '#141414';
const WHITE_PEDESTAL = '#e6e6e6';
const LIGHT = 0.6;
const DEEP = 0.4;
// Channel steps by which blue must lead red for the part to read blue rather than grey.
const BLUE_MARGIN = 40;

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
  test.each(MEASURED_ORANGES)(
    'leaves the %s part reading blue on screen, not grey',
    color => {
      const look = highlightLookFor({ color });
      // The renderer mixes the captured colour toward the tint, then scales it.
      const [r, , b] = [1, 3, 5].map((at, i) => {
        const part = parseInt(color.slice(at, at + 2), 16);
        const tint = Object.values(channels(look.tintRgb))[i];
        return (part + (tint - part) * look.tintAmount) * look.partBrightness;
      });
      expect(b - r).toBeGreaterThan(BLUE_MARGIN);
    },
  );

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
