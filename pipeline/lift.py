# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy<2", "opencv-python-headless", "pillow", "scipy"]
# ///
"""Lift a part's per-photo masks onto the splat: every splat takes the side most of its visible light fell on.

Each photo is composited coarsely from splat centres (front to back per cell), so a splat's say in a photo is how
much it contributes there: its opacity times the light that gets past the splats in front of it. The votes are then
pooled over each splat's nearest neighbours in 3D, which removes speckle and labels splats hidden inside the part.

Run:  uv run lift.py --masks ../data/segment/marks/engine [--tracked ../data/segment/tracks/engine] [--leave-one-out]
Out:  data/segment/lift/<part>/labels.npy (one bool per splat, PLY order), report.json, views.jpg and tinted.ply.
"""

import argparse
import json
import pathlib
import struct
import time

import cv2
import numpy as np

HERE = pathlib.Path(__file__).parent
DATA = HERE.parent / "data"
SPLAT = DATA / "splat" / "engine_30000.ply"
SPARSE = DATA / "capture" / "full" / "sparse" / "0"  # the reconstruction Brush trained on
PHOTOS = DATA / "capture" / "jpg"
CELL = 4                    # compositing cell in mask pixels; coarse enough that splat centres cover it
FOV_MARGIN = 1.3            # how far past the image corner (squared normalised radius) a ray may still project
MIN_WEIGHT = 0.05           # a neighbourhood contributing less than this over all photos stays unlabelled
NEIGHBOURS = 16             # splats whose votes are pooled, the splat itself included
REJECT_IOU = 0.3            # a tracked mask this far from what the other photos agree on stops voting
HIGHLIGHT_RGB = (0.22, 0.74, 0.97)  # the guide's accent, sky blue (#38BDF8)
HIGHLIGHT_MIX = 0.65                # how much of a highlighted splat's colour the accent replaces
SH_C0 = 0.28209479177387814
OPENCV = 4


def read_ply(path: pathlib.Path) -> tuple[np.ndarray, bytes]:
    with open(path, "rb") as f:
        header, names, count = b"", [], 0
        while not header.endswith(b"end_header\n"):
            line = f.readline()
            header += line
            if line.startswith(b"element vertex"):
                count = int(line.split()[2])
            elif line.startswith(b"property float"):
                names.append(line.split()[2].decode())
            elif line.startswith(b"property"):
                raise ValueError(f"unexpected PLY property {line!r}")
        offset = f.tell()
    return np.memmap(path, dtype=[(n, "<f4") for n in names], mode="r", offset=offset, shape=(count,)), header


def read_cameras(sparse: pathlib.Path) -> dict[str, tuple]:
    """Photo name → (world-to-camera rotation, translation, (width, height, OPENCV params))."""
    with open(sparse / "cameras.bin", "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        cameras = {}
        for _ in range(n):
            camera_id, model, width, height = struct.unpack("<iiQQ", f.read(24))
            assert model == OPENCV, f"camera model {model}; only OPENCV is handled"
            cameras[camera_id] = (width, height, struct.unpack("<8d", f.read(64)))
    images = {}
    with open(sparse / "images.bin", "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        for _ in range(n):
            _, w, x, y, z, tx, ty, tz, camera_id = struct.unpack("<idddddddi", f.read(64))
            name = b""
            while (c := f.read(1)) != b"\0":
                name += c
            (points,) = struct.unpack("<Q", f.read(8))
            f.seek(24 * points, 1)
            rotation = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                                 [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                                 [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])
            images[pathlib.Path(name.decode()).name] = (rotation, np.array([tx, ty, tz]), cameras[camera_id])
    return images


def project(points: np.ndarray, rotation, translation, camera, scale: float):
    """COLMAP OPENCV projection (the model Brush trains with), in pixels of the photo resized by `scale`.

    Points behind the camera or far outside the field of view come back as NaN.
    """
    width, height, (fx, fy, cx, cy, k1, k2, p1, p2) = camera
    cam = np.einsum("ij,kj->ki", rotation, points) + translation  # matmul warns spuriously with Accelerate
    z = cam[:, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        x, y = cam[:, 0] / z, cam[:, 1] / z
    r2 = x * x + y * y
    # The distortion polynomial folds far off-axis rays back into the frame.
    corner = ((max(cx, width - cx) / fx) ** 2 + (max(cy, height - cy) / fy) ** 2) * FOV_MARGIN
    valid = (z > 1e-3) & (r2 < corner)
    x, y = np.where(valid, x, np.nan), np.where(valid, y, np.nan)
    radial = 1 + k1 * r2 + k2 * r2 * r2
    xd = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x)
    yd = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y
    return (fx * xd + cx) * scale, (fy * yd + cy) * scale, z


def contributions(u, v, z, alpha, width: int, height: int):
    """Splats that land in the photo: index, pixel, compositing cell and weight (alpha times the light left)."""
    with np.errstate(invalid="ignore"):
        inside = np.flatnonzero((u >= 0) & (u < width) & (v >= 0) & (v < height))
    px, py = u[inside].astype(np.int64), v[inside].astype(np.int64)
    cell = (py // CELL) * -(-width // CELL) + px // CELL
    order = np.lexsort((z[inside], cell))  # by cell, then front to back
    inside, px, py, cell = inside[order], px[order], py[order], cell[order]
    a = np.minimum(alpha[inside], 0.99)
    log_left = np.cumsum(np.log1p(-a))
    starts = np.flatnonzero(np.r_[True, cell[1:] != cell[:-1]])
    before = np.r_[0.0, log_left[:-1]]  # light absorbed by everything earlier in the run...
    before -= np.repeat(np.r_[0.0, log_left[starts[1:] - 1]], np.diff(np.r_[starts, len(cell)]))  # ...in this cell
    return inside, px, py, cell, a * np.exp(before)


def composite(values: np.ndarray, cell, weight, width: int, height: int) -> np.ndarray:
    """Per-cell weighted average of `values` ([n] or [n, c]); cells nothing lands in are NaN."""
    shape = (-(-height // CELL), -(-width // CELL))
    total = np.bincount(cell, weight, shape[0] * shape[1])
    columns = values.reshape(len(cell), -1)
    out = np.stack([np.bincount(cell, weight * columns[:, c], total.size) for c in range(columns.shape[1])], 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        out /= total[:, None]
    out[total < 1e-3] = np.nan
    return out.reshape(*shape, *values.shape[1:])


def load_masks(folder: pathlib.Path) -> dict[int, np.ndarray]:
    return {int(p.stem): cv2.imread(str(p), cv2.IMREAD_GRAYSCALE) > 0 for p in sorted(folder.glob("[0-9]*.png"))}


class Scene:
    """Splat centres (opacity, base colour) and the posed photos, numbered like the photos sorted by name."""

    def __init__(self, points: np.ndarray, alpha: np.ndarray, colour: np.ndarray, poses: list[tuple],
                 photos: list[pathlib.Path] | None = None):
        self.points, self.alpha, self.colour, self.poses, self.photos = points, alpha, colour, poses, photos
        self.cache, self.neighbours = {}, None

    def view(self, frame: int, width: int, height: int):
        key = (frame, width, height)
        if key not in self.cache:
            rotation, translation, camera = self.poses[frame]
            scale = width / camera[0]
            assert round(camera[1] * scale) == height, f"{width}x{height} is not the shape of camera {camera[:2]}"
            u, v, z = project(self.points, rotation, translation, camera, scale)
            self.cache[key] = contributions(u, v, z, self.alpha, width, height)
        return self.cache[key]

    def photo(self, frame: int, width: int, height: int) -> np.ndarray:
        """Stored-layout pixels (EXIF orientation ignored), like the masks and the COLMAP cameras."""
        photo = cv2.imread(str(self.photos[frame]), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        return cv2.resize(photo, (width, height), interpolation=cv2.INTER_AREA)

    def votes(self, views: dict[int, tuple[np.ndarray, float]]) -> np.ndarray:
        """Per splat: [weight inside the masks, total weight]. Additive over photos."""
        votes = np.zeros((2, len(self.points)))
        for frame, (mask, trust) in views.items():
            index, px, py, _, weight = self.view(frame, mask.shape[1], mask.shape[0])
            votes[0] += trust * np.bincount(index, weight * mask[py, px], len(self.points))
            votes[1] += trust * np.bincount(index, weight, len(self.points))
        return votes

    def labels(self, votes: np.ndarray) -> np.ndarray:
        """Majority of the light each splat's neighbourhood sent through the masks."""
        if self.neighbours is None:
            from scipy.spatial import cKDTree

            _, self.neighbours = cKDTree(self.points).query(self.points, NEIGHBOURS, workers=-1)
        inside, total = votes[:, self.neighbours].sum(-1)
        return (total >= MIN_WEIGHT) & (inside > 0.5 * total)

    def check(self, labels: np.ndarray, frame: int, mask: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
        """Composite the labels in a photo and compare with its mask cell by cell: IoU, rendered cells, mask cells.

        A part in front takes every cell it partly covers, so it renders up to a cell wider and even perfect labels
        score below 1. Compare variants with each other, not with 1.
        """
        height, width = mask.shape
        index, _, _, cell, weight = self.view(frame, width, height)
        share = composite(labels[index].astype(np.float64), cell, weight, width, height)
        rendered = share > 0.5
        truth = cv2.resize(mask.astype(np.float32), rendered.shape[::-1], interpolation=cv2.INTER_AREA) > 0.5
        known = ~np.isnan(share)  # cells no splat centre lands in say nothing about the labels
        union = ((rendered | truth) & known).sum()
        return float((rendered & truth & known).sum() / union) if union else 1.0, rendered, truth

    def preview(self, frame: int, mask: np.ndarray, rendered: np.ndarray, truth: np.ndarray) -> np.ndarray:
        """The photo with its mask beside the splat composite with the labels, both upright."""
        height, width = mask.shape
        index, _, _, cell, weight = self.view(frame, width, height)
        colour = np.nan_to_num(composite(self.colour[index], cell, weight, width, height))
        render = (colour * 255).astype(np.uint8)
        photo = self.photo(frame, rendered.shape[1], rendered.shape[0])
        for image, on in ((photo, truth), (render, rendered)):
            accent = 255 * np.array(HIGHLIGHT_RGB[::-1])  # BGR
            image[on] = ((1 - HIGHLIGHT_MIX) * image[on] + HIGHLIGHT_MIX * accent).astype(np.uint8)
        return np.hstack([cv2.rotate(photo, cv2.ROTATE_90_CLOCKWISE), cv2.rotate(render, cv2.ROTATE_90_CLOCKWISE)])


def voters(scene: Scene, keyframes: dict[int, np.ndarray], tracked: dict[int, np.ndarray], trust: float):
    """Photos that vote and how much, and the tracked photos left out.

    The tracker sometimes follows the wrong object; the other photos outvote it, and then it stops voting.
    The owner's keyframes always vote.
    """
    views = {f: (m, trust) for f, m in tracked.items()} | {f: (m, 1.0) for f, m in keyframes.items()}
    labels = scene.labels(scene.votes(views))
    rejected = sorted(f for f in tracked if f not in keyframes and scene.check(labels, f, tracked[f])[0] < REJECT_IOU)
    return {f: v for f, v in views.items() if f not in rejected}, rejected


def load_scene(splat: np.ndarray) -> Scene:
    points = np.stack([splat[k] for k in "xyz"], 1).astype(np.float64)
    alpha = 1 / (1 + np.exp(-np.asarray(splat["opacity"], np.float64)))
    colour = np.clip(0.5 + SH_C0 * np.stack([splat[f"f_dc_{c}"] for c in (2, 1, 0)], 1), 0, 1)  # BGR
    photos = sorted(PHOTOS.glob("*.jpg"))
    cameras = read_cameras(SPARSE)
    missing = [p.name for p in photos if p.name not in cameras]
    assert not missing, f"photos without a pose: {missing[:3]}"
    return Scene(points, alpha, colour, [cameras[p.name] for p in photos], photos)


def sheet(tiles: list[np.ndarray], per_row: int = 4) -> np.ndarray:
    tiles = tiles + [np.zeros_like(tiles[0])] * (-len(tiles) % per_row)
    return np.vstack([np.hstack(tiles[i : i + per_row]) for i in range(0, len(tiles), per_row)])


def label(tile: np.ndarray, text: str) -> np.ndarray:
    cv2.putText(tile, text, (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 4)
    cv2.putText(tile, text, (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
    return tile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--masks", type=pathlib.Path, required=True, help="the owner's keyframe masks")
    parser.add_argument("--tracked", type=pathlib.Path, help="sam_track output: masks/ and report.json")
    parser.add_argument("--tracked-trust", type=float, default=1.0, help="vote weight of a tracked mask")
    parser.add_argument("--leave-one-out", action="store_true", help="score each keyframe lifted without it")
    parser.add_argument("--out", type=pathlib.Path, default=DATA / "segment" / "lift")
    args = parser.parse_args()
    part = args.masks.name
    started = time.time()

    splat, header = read_ply(SPLAT)
    scene = load_scene(splat)
    keyframes = load_masks(args.masks)
    tracked = {}
    if args.tracked:
        scores = json.loads((args.tracked / "report.json").read_text())["photos"]
        # A negative score means the tracker lost the part, not that it is absent: such a mask must not vote.
        tracked = {f: m for f, m in load_masks(args.tracked / "masks").items()
                   if f not in keyframes and scores[str(f)]["score"] > 0}
    views, rejected = voters(scene, keyframes, tracked, args.tracked_trust)
    print(f"{len(scene.points):,} splats; {len(keyframes)} keyframes and {len(tracked) - len(rejected)} tracked "
          f"photos vote; rejected {[f + 1 for f in rejected]} ({time.time() - started:.0f} s)")
    report = {"part": part, "splats": len(scene.points), "keyframes": sorted(keyframes),
              "tracked": sorted(set(tracked) - set(rejected)), "rejected": rejected}
    out = args.out / part
    out.mkdir(parents=True, exist_ok=True)

    if args.leave_one_out:
        # Tracked masks were made from every keyframe, so they leak the hidden one a little; keyframes-only does not.
        report["leave_one_out"] = {}
        tiles = []
        votes = scene.votes(views)
        for hidden in sorted(keyframes):
            labels = scene.labels(votes - scene.votes({hidden: views[hidden]}))
            score, rendered, truth = scene.check(labels, hidden, keyframes[hidden])
            report["leave_one_out"][hidden] = round(score, 4)
            tiles.append(label(scene.preview(hidden, keyframes[hidden], rendered, truth),
                               f"{hidden + 1} hidden: IoU {score:.2f}"))
            print(f"photo {hidden + 1} hidden: IoU {score:.3f} ({time.time() - started:.0f} s)")
        scores = list(report["leave_one_out"].values())
        report["leave_one_out_mean"] = float(np.mean(scores))
        print(f"leave-one-out IoU: mean {np.mean(scores):.3f}, min {np.min(scores):.3f}")
        cv2.imwrite(str(out / "leave_one_out.jpg"), sheet(tiles), [cv2.IMWRITE_JPEG_QUALITY, 85])

    labels = scene.labels(scene.votes(views))
    report["labelled"] = int(labels.sum())
    print(f"{labels.sum():,} splats labelled {part} ({time.time() - started:.0f} s)")
    report["views"], tiles = {}, []
    for frame, (mask, _) in sorted(views.items()):
        score, rendered, truth = scene.check(labels, frame, mask)
        report["views"][frame] = round(score, 4)
        if frame in keyframes:
            tiles.append(label(scene.preview(frame, mask, rendered, truth), f"{frame + 1}: IoU {score:.2f}"))
    report["mean_iou"] = float(np.mean(list(report["views"].values())))
    print(f"re-composited IoU: mean {report['mean_iou']:.3f} over {len(views)} photos")

    np.save(out / "labels.npy", labels)
    (out / "report.json").write_text(json.dumps(report, indent=2))
    cv2.imwrite(str(out / "views.jpg"), sheet(tiles), [cv2.IMWRITE_JPEG_QUALITY, 85])
    # A copy of the splat with the part tinted in the accent, to open in any splat viewer.
    tinted = np.array(splat)
    accent = (np.array(HIGHLIGHT_RGB) - 0.5) / SH_C0
    for channel in range(3):
        name = f"f_dc_{channel}"
        tinted[name][labels] = (1 - HIGHLIGHT_MIX) * tinted[name][labels] + HIGHLIGHT_MIX * accent[channel]
    with open(out / "tinted.ply", "wb") as f:
        f.write(header)
        f.write(tinted.tobytes())
    print(f"written to {out} ({time.time() - started:.0f} s)")


if __name__ == "__main__":
    main()
