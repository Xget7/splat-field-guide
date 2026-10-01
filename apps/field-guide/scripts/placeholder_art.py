# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""Draw the art for the library's "Coming soon" guides.

Seeded clusters of soft dots in one hue each: they read as an unfinished capture and can
never be mistaken for a real one.

    uv run scripts/placeholder_art.py
"""

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

WIDTH, HEIGHT = 720, 480
DOTS = 2600
CLUSTERS = 5
OUT = Path(__file__).resolve().parent.parent / "assets" / "guides"

# file name: (seed, hue in degrees)
ART = {
    "soon-tactical-truck.png": (7, 30),
    "soon-rotorcraft.png": (33, 205),
    "soon-generator.png": (41, 45),
    "soon-drilling-rig.png": (52, 18),
}


def hsl(hue: float, saturation: float, lightness: float) -> tuple[int, int, int]:
    c = (1 - abs(2 * lightness - 1)) * saturation
    x = c * (1 - abs((hue / 60) % 2 - 1))
    m = lightness - c / 2
    sector = int(hue // 60) % 6
    r, g, b = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)][sector]
    return tuple(round((v + m) * 255) for v in (r, g, b))


def draw(seed: int, hue: float) -> Image.Image:
    rng = random.Random(seed)
    clusters = [
        (
            WIDTH * (0.18 + 0.64 * rng.random()),
            HEIGHT * (0.3 + 0.45 * rng.random()),
            WIDTH * (0.07 + 0.16 * rng.random()),
            HEIGHT * (0.06 + 0.15 * rng.random()),
        )
        for _ in range(CLUSTERS)
    ]
    image = Image.new("RGB", (WIDTH, HEIGHT), (5, 5, 6))
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    pen = ImageDraw.Draw(layer)
    for i in range(DOTS):
        cx, cy, sx, sy = clusters[i % CLUSTERS]
        x, y = rng.gauss(cx, sx), rng.gauss(cy, sy)
        radius = 1.5 + rng.random() ** 2 * 9
        alpha = round(255 * (0.1 + rng.random() * 0.3))
        color = hsl(hue, 0.06 + rng.random() * 0.14, 0.16 + rng.random() * 0.4)
        pen.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(2.2))
    image.paste(layer, (0, 0), layer)
    return image


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (seed, hue) in ART.items():
        draw(seed, hue).save(OUT / name, optimize=True)
        print(OUT / name)
