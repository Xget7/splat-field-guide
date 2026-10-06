"""Cloud and labels share a crop and transform into right-handed RUB coordinates with +Y up."""

import argparse
import gzip
import itertools
import json
import math
import pathlib
import struct
import subprocess
import time

import numpy as np
import yaml
from PIL import Image

from pipeline import artifacts
from pipeline.pack import knowledge
from pipeline.pack import lift
from pipeline.pack import mask_tools
HERE = pathlib.Path(__file__).parent
DATA = HERE.parents[1] / "data"
CONTENT = HERE.parents[1] / "content" / "gol-trend-engine-bay" / "pack.yaml"
KNOWLEDGE = CONTENT.with_name("knowledge.md")
PACK_ID = "gol-trend-engine-bay"
PACK_VERSION = 1
PACK_TITLE = "VW Gol Trend 1.6 engine bay"
SCHEMA_VERSION = 1
TIER = "high"
CLOUD_PATH, LABELS_PATH = f"{TIER}/cloud.spz", f"{TIER}/labels.bin"

EXIF_ORIENTATION = 274
EXIF_IFD, EXIF_MAKER_NOTE = 0x8769, 0x927C
APPLE_MAKER_NOTE = b"Apple iOS\0"
APPLE_IFD_OFFSET = 14           # after the signature, a version and "MM"; offsets count from the note's start
APPLE_ACCELERATION = 0x0008     # three signed rationals, in g
EXIF_SRATIONAL = 10
# Core Motion gravity points down in device axes (right, top, out); rear stored pixels follow (-y, -x, -z), so this maps gravity to COLMAP camera up (right, down, forward).
UP_FROM_DEVICE_GRAVITY = np.array([[0.0, 1, 0], [1, 0, 0], [0, 0, 1]])
UP_SIGMA_DEG = 15.0            # photos further than this from the up estimate lose weight (Cauchy scale)
UP_ITERATIONS = 20
GRAVITY_AGREEMENT_DEG = 5.0     # Maximum median gravity deviation in the COLMAP world.
UPRIGHT_FRACTION = 0.9          # at least this share of photos must show up above their centre, as a phone is held
BATTERY_LABEL_ID = "battery"
BATTERY_LONGEST_SIDE_M = 0.242  # Assumed battery dimension, pending physical measurement.
BATTERY_ASPECT = 242 / 175      # its longest over its shortest horizontal side, to sanity-check the estimate
EXTENT_PERCENTILE = 2.0         # robust extent of a part: 2nd to 98th percentile of its splat centres
CROP_PERCENTILE = 0.5           # Crop bounds use symmetric percentiles of labelled splats.
CROP_MARGIN = 0.25              # Relative side margins keep the crop below the capture cameras.

SH_C0 = lift.SH_C0
SH_MAX_DEGREE = 3
SH_FIT_DIRECTIONS = 4096
SH_FIT_TOLERANCE = 1e-9
SH_SEED = 7

# SPZ encoding follows nianticlabs/spz src/cc/load-spz.cc at the app's pinned revision.
SPZ_MAGIC = 0x5053474E          # "NGSP"
SPZ_VERSION = 3                 # gzip container with smallest-three quaternions; the app's decoder reads 1 to 4
SPZ_HEADER = struct.Struct("<IIIBBBB")
SPZ_FRACTIONAL_BITS = 12        # positions are 24-bit fixed point, about 0.25 mm
SPZ_COLOUR_SCALE = 0.15         # DC colour is stored as dc * 0.15 * 255 + 127.5
SPZ_LOG_SCALE_OFFSET, SPZ_LOG_SCALE_STEPS = 10.0, 16.0
SPZ_SH1_BITS, SPZ_SH_REST_BITS = 5, 4   # the reference defaults
SPZ_SH1_COEFFS = 3
SPZ_QUAT_BITS = 9
SQRT1_2 = 0.707106781186547524401
GZIP_LEVEL = 9

LABELS_MAGIC = b"SFGL"
LABELS_HEADER = struct.Struct("<4sHHII")
LABELS_VERSION, LABEL_BYTES = 1, 1
FRAME_FOV_DEG = 45.0            # assumed field of view when framing the labelled parts
ELEVATION_LIMIT_DEG = (5.0, 85.0)  # the orbit never goes below the floor or over the pole
LIMIT_DECIMALS = 1              # angles in the manifest are rounded to this many decimals, limits outwards
CAMERA_PERCENTILE = 2.0         # limits follow the photos' own viewpoints between these percentiles
RADIUS_MARGIN = 0.8             # minimum radius: this fraction of the closest photo's distance
RADIUS_DECIMALS = 3             # Radii round outwards to preserve framing limits.
# Match SplatEngine.cpp so radius limits fit the largest part in the app's narrowest view.
ENGINE_FOV_Y_DEG = 65.0         # SplatEngine::kFieldOfViewRadians
ENGINE_FRAMING_MARGIN = 1.05    # kFramingMargin: a framed box fills at most 1 / this of the half view
ENGINE_NEAR_PLANE = 0.05        # kNearPlane
NARROWEST_VIEW_ASPECT = 9 / 19.5  # width over height of a phone held upright, the view full screen


def sha256(path: pathlib.Path) -> str:
    return artifacts.sha256(path)


def dot(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """einsum avoids spurious Accelerate matmul warnings on large finite arrays."""
    return np.einsum("ij,jk->ik", a, b)


def round_half_away(x: np.ndarray) -> np.ndarray:
    """C's std::round, which the reference encoder uses; numpy rounds halves to even."""
    return np.sign(x) * np.floor(np.abs(x) + 0.5)



def load_splats(splat: np.ndarray, keep: np.ndarray | None = None, degree: int | None = None) -> dict:
    """The PLY columns as float32 arrays; `sh` is [n, coefficients, 3] (band 0 excluded), RGB the last axis."""
    rows = slice(None) if keep is None else keep

    def col(name: str) -> np.ndarray:
        return np.asarray(splat[name][rows], np.float32)

    available = sum(n.startswith("f_rest_") for n in splat.dtype.names) // 3
    ply_degree = round(math.sqrt(available + 1)) - 1
    degree = ply_degree if degree is None else degree
    assert 0 <= degree <= min(ply_degree, SH_MAX_DEGREE), f"SH degree {degree}: the PLY carries {ply_degree}"
    coeffs = (degree + 1) ** 2 - 1
    # Brush writes f_rest channel-major: all red coefficients, then green, then blue.
    sh = np.zeros((len(col("opacity")), 0, 3), np.float32)
    if coeffs:
        sh = np.stack([np.stack([col(f"f_rest_{c * available + k}") for k in range(coeffs)], 1) for c in range(3)], 2)
    return {
        "positions": np.stack([col(k) for k in "xyz"], 1),
        "log_scales": np.stack([col(f"scale_{i}") for i in range(3)], 1),
        "quats_wxyz": np.stack([col(f"rot_{i}") for i in range(4)], 1),
        "opacity": col("opacity"),
        "dc": np.stack([col(f"f_dc_{i}") for i in range(3)], 1),
        "sh": sh,
        "degree": degree,
        "ply_degree": ply_degree,
    }


def read_labels(path: pathlib.Path, count: int, part_ids: list[str], mask_part: str) -> np.ndarray:
    """One uint8 per splat, 1-based in pack.yaml part order. A boolean mask is taken as `mask_part` alone."""
    raw = np.load(path)
    assert raw.shape == (count,), f"{path} has shape {raw.shape}; the PLY has {count} splats"
    if raw.dtype == bool:
        labels = np.zeros(count, np.uint8)
        labels[raw] = part_ids.index(mask_part) + 1
        return labels
    assert raw.dtype == np.uint8, f"{path} is {raw.dtype}; expected uint8 or bool"
    assert raw.max() <= len(part_ids), f"{path} holds label {raw.max()}; pack.yaml has {len(part_ids)} parts"
    return raw



def display_axes(orientation: int) -> tuple[np.ndarray, np.ndarray]:
    """Up and right of the upright photo, as unit vectors in the camera frame of its stored pixels (x right, y down)."""
    def axis(dx: float, dy: float) -> np.ndarray:
        x, y = mask_tools.raw_from_display(0.5 + dx, 0.5 + dy, orientation)
        v = np.array([x - 0.5, y - 0.5, 0.0])
        return v / np.linalg.norm(v)
    return axis(0, -0.5), axis(0.5, 0)


def read_orientations(photos: list[pathlib.Path]) -> list[int]:
    found = []
    for path in photos:
        with Image.open(path) as photo:
            found.append(photo.getexif().get(EXIF_ORIENTATION, 1))
    unsupported = sorted({o for o in found if o not in (1, 3, 6, 8)})
    assert not unsupported, f"EXIF orientations {unsupported} are not handled"
    return found


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def apple_gravity(maker_note: bytes) -> np.ndarray | None:
    """The acceleration vector of an Apple MakerNote, in g; None when the note is not Apple's or lacks one."""
    if not maker_note.startswith(APPLE_MAKER_NOTE) or maker_note[APPLE_IFD_OFFSET - 2:APPLE_IFD_OFFSET] != b"MM":
        return None
    (count,) = struct.unpack_from(">H", maker_note, APPLE_IFD_OFFSET)
    for i in range(count):
        tag, kind, n, offset = struct.unpack_from(">HHII", maker_note, APPLE_IFD_OFFSET + 2 + 12 * i)
        if tag == APPLE_ACCELERATION and kind == EXIF_SRATIONAL and n == 3:
            values = struct.unpack_from(">6i", maker_note, offset)
            return np.array([values[j] / values[j + 1] for j in (0, 2, 4)], np.float64)
    return None


def read_device_gravity(photos: list[pathlib.Path]) -> np.ndarray:
    """Per photo, the gravity its iPhone recorded, in device axes [n, 3]."""
    found = []
    for path in photos:
        with Image.open(path) as photo:
            found.append(apple_gravity(photo.getexif().get_ifd(EXIF_IFD).get(EXIF_MAKER_NOTE, b"")))
    missing = [p.name for p, g in zip(photos, found) if g is None]
    assert not missing, f"{len(missing)} photos carry no Apple acceleration vector, e.g. {missing[:3]}"
    return np.stack(found)


def camera_geometry(poses: list[tuple], orientations: list[int], device_gravity: np.ndarray) -> dict[str, np.ndarray]:
    """Per photo, in the COLMAP world: centre, gravity up, display-up and the viewing direction."""
    rotations = np.stack([p[0] for p in poses])
    translations = np.stack([p[1] for p in poses])
    gravity_up = device_gravity @ UP_FROM_DEVICE_GRAVITY.T
    display_up = np.stack([display_axes(o)[0] for o in orientations])

    def world(v: np.ndarray) -> np.ndarray:  # camera-to-world is the transpose
        return np.einsum("nji,nj->ni", rotations, v)

    return {"centres": -world(translations), "gravity_up": unit(world(gravity_up)), "display_up": world(display_up),
            "forward": world(np.tile([0.0, 0.0, 1.0], (len(poses), 1)))}


def robust_direction(directions: np.ndarray) -> tuple[np.ndarray, dict]:
    """The robust mean of unit vectors (Cauchy-weighted, iterated) and how far they spread from it."""
    mean = unit(directions.mean(0))
    for _ in range(UP_ITERATIONS):
        angle = np.degrees(np.arccos(np.clip(directions @ mean, -1, 1)))
        weight = 1 / (1 + (angle / UP_SIGMA_DEG) ** 2)
        mean = unit((weight[:, None] * directions).sum(0))
    angle = np.degrees(np.arccos(np.clip(directions @ mean, -1, 1)))
    return mean, {"median_deviation_deg": float(np.median(angle)),
                  "p90_deviation_deg": float(np.percentile(angle, 90))}


def estimate_up(cameras: dict[str, np.ndarray]) -> tuple[np.ndarray, dict]:
    """Gravity disagreement detects device mapping errors; inverted display-up detects a flipped gravity sign."""
    up, stats = robust_direction(cameras["gravity_up"])
    assert stats["median_deviation_deg"] < GRAVITY_AGREEMENT_DEG, \
        f"the photos' gravity spreads {stats['median_deviation_deg']:.1f} degrees (median) in the COLMAP world"
    upright = float((cameras["display_up"] @ up > 0).mean())
    assert upright >= UPRIGHT_FRACTION, f"only {upright:.0%} of the photos show up above their centre"
    pitch = np.degrees(np.arcsin(np.clip(cameras["forward"] @ up, -1, 1)))
    return up, {**stats, "upright_fraction": upright, "median_pitch_deg": float(np.median(pitch)),
                "pitch_range_deg": [float(pitch.min()), float(pitch.max())]}


def level_rotation(up: np.ndarray, forward: np.ndarray) -> np.ndarray:
    """Right-handed rows are right, up and back in COLMAP coordinates, placing the home camera on +Z."""
    horizontal = forward - (forward @ up) * up
    back = -horizontal / np.linalg.norm(horizontal)
    return np.stack([np.cross(up, back), up, back])



def quat_from_matrix(m: np.ndarray) -> np.ndarray:
    from scipy.spatial.transform import Rotation

    x, y, z, w = Rotation.from_matrix(m).as_quat()
    return np.array([w, x, y, z])


def quat_multiply(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Hamilton product of wxyz quaternions, broadcast over rows."""
    aw, ax, ay, az = np.moveaxis(a, -1, 0)
    bw, bx, by, bz = np.moveaxis(b, -1, 0)
    return np.stack([aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw], -1)


def sh_basis(d: np.ndarray, degree: int) -> np.ndarray:
    """Real SH values of bands 1..degree at unit directions [n, 3], in the order and signs Brush and 3DGS use."""
    x, y, z = d[:, 0], d[:, 1], d[:, 2]
    xx, yy, zz = x * x, y * y, z * z
    columns = [-0.4886025119029199 * y, 0.4886025119029199 * z, -0.4886025119029199 * x]
    if degree >= 2:
        columns += [1.0925484305920792 * x * y, -1.0925484305920792 * y * z, 0.31539156525252005 * (2 * zz - xx - yy),
                    -1.0925484305920792 * x * z, 0.5462742152960396 * (xx - yy)]
    if degree >= 3:
        columns += [-0.5900435899266435 * y * (3 * xx - yy), 2.890611442640554 * x * y * z,
                    -0.4570457994644658 * y * (4 * zz - xx - yy), 0.3731763325901154 * z * (2 * zz - 3 * xx - 3 * yy),
                    -0.4570457994644658 * x * (4 * zz - xx - yy), 1.445305721320277 * z * (xx - yy),
                    -0.5900435899266435 * x * (xx - 3 * yy)]
    return np.stack(columns, 1)


def sh_rotation(rotation: np.ndarray, degree: int) -> np.ndarray:
    """Fit each band independently so colour at d' equals the original colour at R^T d', with new_coefficients = M @ coefficients."""
    d = np.random.default_rng(SH_SEED).normal(size=(SH_FIT_DIRECTIONS, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    at, turned = sh_basis(d, degree), sh_basis(dot(d, rotation), degree)  # d @ R is R^T d per row
    m = np.zeros((at.shape[1], at.shape[1]))
    for band in range(1, degree + 1):
        lo, hi = band * band - 1, (band + 1) ** 2 - 1
        fit, residual, *_ = np.linalg.lstsq(at[:, lo:hi], turned[:, lo:hi], rcond=None)
        residual = np.abs(dot(at[:, lo:hi], fit) - turned[:, lo:hi]).max()
        assert residual < SH_FIT_TOLERANCE, f"SH band {band} is not a rotation (residual {residual:.2g})"
        m[lo:hi, lo:hi] = fit
    return m


class Placement:
    """The similarity that takes COLMAP coordinates to the pack: p' = scale * R (p - origin)."""

    def __init__(self, rotation: np.ndarray, origin: np.ndarray, scale: float):
        self.rotation, self.origin, self.scale = rotation, origin, scale

    def points(self, p: np.ndarray) -> np.ndarray:
        return self.scale * dot(p - self.origin, self.rotation.T)

    def camera(self, rotation: np.ndarray, translation: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """A world-to-camera pose for the pack's coordinates, scaled like them."""
        return rotation @ self.rotation.T, self.scale * (translation + rotation @ self.origin)

    def apply(self, cloud: dict) -> dict:
        turn = quat_from_matrix(self.rotation)
        out = dict(cloud)
        out["positions"] = self.points(cloud["positions"].astype(np.float64)).astype(np.float32)
        quats = cloud["quats_wxyz"]
        out["quats_wxyz"] = quat_multiply(turn, quats / np.linalg.norm(quats, axis=1, keepdims=True))
        out["log_scales"] = cloud["log_scales"] + np.float32(math.log(self.scale))
        if cloud["degree"]:
            turn_sh = sh_rotation(self.rotation, cloud["degree"]).astype(np.float32)
            out["sh"] = np.einsum("kj,njc->nkc", turn_sh, cloud["sh"])
        return out


def estimate_scale(points: np.ndarray) -> dict:
    flat = points[:, [0, 2]] - points[:, [0, 2]].mean(0)
    axes = np.linalg.eigh(dot(flat.T, flat))[1]
    ends = [100 - EXTENT_PERCENTILE, EXTENT_PERCENTILE]
    sides = [np.subtract(*np.percentile(dot(flat, a[:, None])[:, 0], ends)) for a in axes.T]
    return {"longest": float(max(sides)), "aspect": float(max(sides) / min(sides))}



def pack_quaternions(q_xyzw: np.ndarray) -> np.ndarray:
    """Smallest-three: the largest component is dropped (sign chosen so it is positive), the rest take 10 bits each."""
    q = (q_xyzw / np.linalg.norm(q_xyzw, axis=1, keepdims=True)).astype(np.float32)
    largest = np.abs(q).argmax(1)
    q *= np.where(q[np.arange(len(q)), largest] < 0, -1, 1).astype(np.float32)[:, None]
    comp = largest.astype(np.uint32)
    for i in range(4):
        used = largest != i
        mag = ((1 << SPZ_QUAT_BITS) - 1) * (np.abs(q[:, i]) / np.float32(SQRT1_2)) + np.float32(0.5)
        field = ((q[:, i] < 0).astype(np.uint32) << SPZ_QUAT_BITS) | mag.astype(np.uint32)
        comp = np.where(used, (comp << 10) | field, comp)
    return comp.astype("<u4").view(np.uint8).reshape(-1, 4)


def quantise_sh(sh: np.ndarray, sh1_bits: int, rest_bits: int) -> tuple[np.ndarray, int]:
    """[n, K, 3] floats to bytes (and how many were clipped): buckets of 1/128, coarser for the higher bands."""
    q = round_half_away(sh * np.float32(128)) + 128
    clipped = int(((q < 0) | (q > 255)).sum())
    bucket = np.full((sh.shape[1], 1), 1 << (8 - rest_bits))
    bucket[:SPZ_SH1_COEFFS] = 1 << (8 - sh1_bits)
    q = np.floor((q + bucket // 2) / bucket) * bucket
    return np.clip(q, 0, 255).astype(np.uint8), clipped


def write_spz(path: pathlib.Path, cloud: dict, sh1_bits: int = SPZ_SH1_BITS, rest_bits: int = SPZ_SH_REST_BITS) -> dict:
    """Write the cloud as SPZ v3 in the RUB frame; returns how many values were clipped by the encoding."""
    n, degree = len(cloud["positions"]), cloud["degree"]
    fixed = round_half_away(cloud["positions"] * np.float32(1 << SPZ_FRACTIONAL_BITS))
    assert np.abs(fixed).max() < 1 << 23, "a position does not fit 24-bit fixed point"
    fixed = fixed.astype(np.int32)
    positions = np.stack([(fixed >> shift) & 0xFF for shift in (0, 8, 16)], 2).astype(np.uint8)

    def byte(x: np.ndarray) -> tuple[np.ndarray, int]:
        r = round_half_away(x.astype(np.float32))
        return np.clip(r, 0, 255).astype(np.uint8), int(((r < 0) | (r > 255)).sum())

    alphas, _ = byte(1 / (1 + np.exp(-cloud["opacity"].astype(np.float64))) * 255)
    colours, colours_clipped = byte(cloud["dc"] * np.float32(SPZ_COLOUR_SCALE * 255) + np.float32(0.5 * 255))
    scales, scales_clipped = byte((cloud["log_scales"] + np.float32(SPZ_LOG_SCALE_OFFSET))
                                  * np.float32(SPZ_LOG_SCALE_STEPS))
    xyzw = cloud["quats_wxyz"][:, [1, 2, 3, 0]]
    sh, sh_clipped = quantise_sh(cloud["sh"], sh1_bits, rest_bits) if degree else (np.zeros((n, 0, 3), np.uint8), 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f, gzip.GzipFile(fileobj=f, mode="wb", compresslevel=GZIP_LEVEL, mtime=0) as z:
        z.write(SPZ_HEADER.pack(SPZ_MAGIC, SPZ_VERSION, n, degree, SPZ_FRACTIONAL_BITS, 0, 0))
        for block in (positions, alphas, colours, scales, pack_quaternions(xyzw), sh):
            z.write(np.ascontiguousarray(block).tobytes())
    return {"colour_values_clipped": colours_clipped, "log_scales_clipped": scales_clipped,
            "sh_values_clipped": sh_clipped}


def write_labels(path: pathlib.Path, labels: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(LABELS_HEADER.pack(LABELS_MAGIC, LABELS_VERSION, LABEL_BYTES, len(labels), 0) + labels.tobytes())



def part_geometry(parts: list[dict], labels: np.ndarray, points: np.ndarray,
                  allow_missing: bool) -> tuple[dict, list[str]]:
    """Per part id: robust bounds and a top anchor from the part's splats and its children's (any depth)."""
    number = {p["id"]: i + 1 for i, p in enumerate(parts)}
    children = {p["id"]: [c["id"] for c in parts if c["parent"] == p["id"]] for p in parts}

    def within(part_id: str) -> list[int]:
        return [number[part_id]] + [n for c in children[part_id] for n in within(c)]

    geometry, missing = {}, []
    for part in parts:
        mine = points[np.isin(labels, within(part["id"]))]
        if len(mine) == 0:
            assert allow_missing, f"no splat carries the label of {part['id']}; --allow-missing-parts to pack anyway"
            missing.append(part["id"])
            geometry[part["id"]] = {"bounds": {"min": [0.0] * 3, "max": [0.0] * 3}, "anchor": [0.0] * 3}
            continue
        lo, hi = np.percentile(mine, [EXTENT_PERCENTILE, 100 - EXTENT_PERCENTILE], axis=0)
        anchor = np.median(mine, axis=0)
        anchor[1] = hi[1]
        geometry[part["id"]] = {"bounds": {"min": lo.round(4).tolist(), "max": hi.round(4).tolist()},
                                "anchor": anchor.round(4).tolist()}
    return geometry, missing


def outward(low: float, high: float, decimals: int = LIMIT_DECIMALS) -> tuple[float, float]:
    """Outward rounding preserves every value inside the original limits."""
    step = 10.0 ** -decimals
    return round(math.floor(low / step) * step, decimals), round(math.ceil(high / step) * step, decimals)


def framing_radius(low: np.ndarray, high: np.ndarray, azimuth_deg: float, elevation_deg: float,
                   aspect: float) -> float:
    """Match the engine's frame distance so every corner fits within the margin and beyond the near plane."""
    azimuth, elevation = math.radians(azimuth_deg), math.radians(elevation_deg)
    forward = -np.array([math.cos(elevation) * math.sin(azimuth), math.sin(elevation),
                         math.cos(elevation) * math.cos(azimuth)])
    right = np.array([math.cos(azimuth), 0.0, -math.sin(azimuth)])
    up = np.cross(right, forward)
    tan_y = math.tan(math.radians(ENGINE_FOV_Y_DEG) / 2)
    tan_x = tan_y * aspect
    corners = np.array(list(itertools.product(*zip(low, high)))) - (np.asarray(low) + np.asarray(high)) / 2
    depth = corners @ forward
    need = np.maximum.reduce([ENGINE_FRAMING_MARGIN * np.abs(corners @ right) / tan_x - depth,
                              ENGINE_FRAMING_MARGIN * np.abs(corners @ up) / tan_y - depth,
                              ENGINE_NEAR_PLANE - depth])
    return float(need.max())


def camera_block(camera_points: np.ndarray, extent: float, part_boxes: list[tuple[np.ndarray, np.ndarray]]) -> dict:
    """Azimuth limits wrap around home, and radius limits must fit every part on an upright phone."""
    horizontal = np.hypot(camera_points[:, 0], camera_points[:, 2])
    elevation = np.degrees(np.arctan2(camera_points[:, 1], horizontal))
    distance = np.linalg.norm(camera_points, axis=1)
    azimuth = np.degrees(np.arctan2(camera_points[:, 0].sum(), camera_points[:, 2].sum()))  # 0 is on +Z
    around_home = (np.degrees(np.arctan2(camera_points[:, 0], camera_points[:, 2])) - azimuth + 180) % 360 - 180
    az_low, az_high = outward(*(azimuth + np.percentile(around_home, [CAMERA_PERCENTILE, 100 - CAMERA_PERCENTILE])))
    low, high = np.clip(np.percentile(elevation, [CAMERA_PERCENTILE, 100 - CAMERA_PERCENTILE]), *ELEVATION_LIMIT_DEG)
    home_radius = float(np.median(distance))
    fit_radius = extent / 2 / math.sin(math.radians(FRAME_FOV_DEG / 2))  # the labelled parts fill the view
    home_elevation = float(np.clip(np.median(elevation), low, high))
    def angle(degrees: float) -> float:
        return round(float(degrees), LIMIT_DECIMALS)

    home_azimuth, home_elevation = angle(azimuth), angle(home_elevation)
    part_fit = max(framing_radius(low_box, high_box, home_azimuth, home_elevation, NARROWEST_VIEW_ASPECT)
                   for low_box, high_box in part_boxes)
    min_radius, max_radius = outward(min(RADIUS_MARGIN * np.percentile(distance, CAMERA_PERCENTILE), fit_radius),
                                     max(np.percentile(distance, 100 - CAMERA_PERCENTILE), home_radius, part_fit),
                                     RADIUS_DECIMALS)

    return {"home": {"azimuth": home_azimuth, "elevation": home_elevation,
                     "radius": round(home_radius, RADIUS_DECIMALS)},
            "limits": {"minAzimuth": az_low, "maxAzimuth": az_high,
                       "minElevation": angle(low), "maxElevation": angle(high),
                       "minRadius": min_radius, "maxRadius": max_radius}}


def file_entry(root: pathlib.Path, rel: str) -> dict:
    return {"path": rel, "bytes": (root / rel).stat().st_size, "sha256": sha256(root / rel)}


def build_manifest(content: dict, out: pathlib.Path, count: int, geometry: dict, camera: dict) -> dict:
    notes = knowledge.read_notes(KNOWLEDGE, content["parts"])
    parts = [{"id": p["id"], "label": i + 1, "parent": p["parent"], "name": p["name"], "aliases": p["aliases"],
              "summary": p["summary"], "details": p["details"], "notes": notes[p["id"]], **geometry[p["id"]]}
             for i, p in enumerate(content["parts"])]
    return {"schemaVersion": SCHEMA_VERSION, "packId": PACK_ID, "packVersion": PACK_VERSION, "title": PACK_TITLE,
            "tiers": [{"id": TIER, "splatCount": count, "cloud": file_entry(out, CLOUD_PATH),
                       "labels": file_entry(out, LABELS_PATH)}],
            "camera": camera, "parts": parts, "procedures": content["procedures"]}



def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ply", type=pathlib.Path, default=lift.SPLAT)
    parser.add_argument("--labels", type=pathlib.Path, default=DATA / "segment" / "lift" / "all" / "labels.npy")
    parser.add_argument("--mask-part", default="engine", help="the part a boolean labels file stands for")
    parser.add_argument("--out", type=pathlib.Path, default=None)
    parser.add_argument("--pack-version", type=int, default=PACK_VERSION)
    parser.add_argument("--replace", action="store_true", help="explicitly replace a published version after verification")
    parser.add_argument("--sh-degree", type=int, help="SH degree to write (default: what the PLY carries)")
    parser.add_argument("--sh1-bits", type=int, default=SPZ_SH1_BITS)
    parser.add_argument("--sh-rest-bits", type=int, default=SPZ_SH_REST_BITS)
    parser.add_argument("--allow-missing-parts", action="store_true",
                        help="pack parts without splats with empty bounds (test packs only)")
    parser.add_argument("--lift-report", type=pathlib.Path, help="identity report from lift_all.py")
    args = parser.parse_args()
    args.out = args.out or DATA / "pack" / PACK_ID / str(args.pack_version)
    assert args.pack_version > 0, "pack version must be positive"
    if args.out.exists() and not args.replace:
        raise ValueError("pack version already published; use a new version or explicitly pass --replace")
    with artifacts.candidate(args.out) as out:
        publish(args, out)


def source_contract(ply: pathlib.Path, labels: pathlib.Path, report_path: pathlib.Path, part_ids: list[str]) -> dict:
    report = json.loads(report_path.read_text())
    mapping = {part: i + 1 for i, part in enumerate(part_ids)}
    assert report["labels"] == mapping, "lifting part-to-label mapping differs from pack.yaml"
    sources = report["sources"]
    assert sources["ply_sha256"] == sha256(ply), "labels belong to a different PLY"
    assert report["labels_sha256"] == sha256(labels), "lifting labels digest mismatch"
    capture = artifacts.capture(lift.PHOTOS)["sha256"]
    reconstruction = artifacts.reconstruction(lift.SPARSE)["sha256"]
    assert sources["capture_sha256"] == capture, "lifting capture identity mismatch"
    assert sources["reconstruction_sha256"] == reconstruction, "lifting reconstruction identity mismatch"

    def entry(path: pathlib.Path) -> dict:
        # Repository paths are portable; external fixtures retain their artifact name.
        try:
            name = path.resolve().relative_to(HERE.parents[1].resolve()).as_posix()
        except ValueError:
            name = path.name
        return {"path": name, "bytes": path.stat().st_size, "sha256": sha256(path)}

    return {"captureSha256": capture, "reconstructionSha256": reconstruction,
            "ply": entry(ply), "labels": entry(labels), "liftingReport": entry(report_path),
            "content": entry(CONTENT), "knowledge": entry(KNOWLEDGE), "partLabels": mapping}


def publish(args, out: pathlib.Path):
    started = time.time()

    def lap(text: str):
        print(f"{text} ({time.time() - started:.0f} s)")

    content = yaml.safe_load(CONTENT.read_text())
    part_ids = [p["id"] for p in content["parts"]]
    splat, _ = lift.read_ply(args.ply)
    count = len(splat)
    sources = source_contract(args.ply, args.labels, args.lift_report or args.labels.with_name("report.json"), part_ids)
    labels = read_labels(args.labels, count, part_ids, args.mask_part)
    assert labels.any(), "no splat is labelled"
    lap(f"{count:,} splats, {int((labels > 0).sum()):,} labelled")

    photos = sorted(lift.PHOTOS.glob("*.jpg"))
    poses = list(lift.read_cameras(lift.SPARSE)[p.name] for p in photos)
    cameras = camera_geometry(poses, read_orientations(photos), read_device_gravity(photos))
    up, up_stats = estimate_up(cameras)
    forward = cameras["forward"].mean(0)
    rotation = level_rotation(up, forward)
    assert np.linalg.det(rotation) > 0, "the levelling must not mirror the cloud"

    points = np.stack([np.asarray(splat[k], np.float64) for k in "xyz"], 1)
    levelled = dot(points, rotation.T)
    marked = labels > 0
    low, high = np.percentile(levelled[marked], [CROP_PERCENTILE, 100 - CROP_PERCENTILE], axis=0)
    origin = (low + high) / 2 @ rotation  # back in COLMAP coordinates

    battery = part_ids.index(BATTERY_LABEL_ID) + 1
    scale_report = {"metric": False, "scale": 1.0,
                    "note": "the battery is not labelled, so the scale is COLMAP units, not metres"}
    if (labels == battery).any():
        side = estimate_scale(levelled[labels == battery])
        scale_report = {"metric": True, "scale": BATTERY_LONGEST_SIDE_M / side["longest"],
                        "battery_units": side["longest"],
                        "battery_aspect": side["aspect"], "expected_aspect": BATTERY_ASPECT,
                        "note": "approximate: scaled so the battery's longest horizontal side is 0.242 m"}
    placement = Placement(rotation, origin, scale_report["scale"])

    placed = placement.points(points)
    box_low, box_high = np.percentile(placed[marked], [CROP_PERCENTILE, 100 - CROP_PERCENTILE], axis=0)
    margin = CROP_MARGIN * (box_high - box_low)
    box_low, box_high = box_low - margin, box_high + margin
    keep = np.flatnonzero(((placed >= box_low) & (placed <= box_high)).all(1))
    labels, placed = labels[keep], placed[keep]
    lap(f"cropped to {len(keep):,} splats, box {np.round(box_low, 3).tolist()} to {np.round(box_high, 3).tolist()}")

    cloud = placement.apply(load_splats(splat, keep, args.sh_degree))
    lap(f"transformed, SH degree {cloud['degree']} (PLY carries {cloud['ply_degree']})")
    clipped = write_spz(out / CLOUD_PATH, cloud, args.sh1_bits, args.sh_rest_bits)
    write_labels(out / LABELS_PATH, labels)
    cloud_mb, labels_mb = ((out / path).stat().st_size / 1e6 for path in (CLOUD_PATH, LABELS_PATH))
    lap(f"written {cloud_mb:.1f} MB cloud, {labels_mb:.1f} MB labels")

    geometry, missing = part_geometry(content["parts"], labels, placed, args.allow_missing_parts)
    marked_points = placed[labels > 0]
    extent = float(np.linalg.norm(np.ptp(marked_points, axis=0)))
    boxes = [(np.array(g["bounds"]["min"]), np.array(g["bounds"]["max"])) for g in geometry.values()]
    camera = camera_block(placement.points(cameras["centres"]), extent, boxes)
    manifest = build_manifest(content, out, len(keep), geometry, camera)
    manifest["sources"] = sources
    manifest["packVersion"] = args.pack_version
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    report = {"splats": {"input": count, "kept": len(keep), "labelled_kept": int((labels > 0).sum()),
                         "label_counts": {i + 1: int((labels == i + 1).sum()) for i in range(len(part_ids))}},
              "spz": {"version": SPZ_VERSION, "frame": "RUB", "sh_degree": cloud["degree"], **clipped},
              "levelling": {"up_in_colmap": up.tolist(), "forward_in_colmap": forward.tolist(), **up_stats,
                            "note": "gravity is the robust mean of the photos' accelerometer readings"},
              "scale": scale_report,
              "placement": {"rotation": rotation.tolist(), "origin": origin.tolist(), "scale": placement.scale},
              "crop": {"min": box_low.tolist(), "max": box_high.tolist(), "margin": margin.tolist()},
              "parts_without_splats": missing,
              "camera": camera,
              "seconds": round(time.time() - started, 1)}
    report["sources"] = sources
    report_path = out / "publication.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    verify = subprocess.run(["node", str(HERE.parents[1] / "scripts/validate-pack.cjs"), str(out)],
                            capture_output=True, text=True)
    assert verify.returncode == 0, verify.stderr.strip()
    from pipeline.pack import export_checks
    export_checks.test_pack_files(out, args.labels, args.mask_part, source_ply=args.ply,
                                  source_report=args.lift_report or args.labels.with_name("report.json"))
    export_checks.test_bounds_and_anchors(out, export_checks.read_spz((out / CLOUD_PATH).read_bytes()), labels)
    lap(f"verified pack ready for publication to {args.out}")
    print(json.dumps({k: report[k] for k in ("levelling", "scale", "parts_without_splats")}, indent=2))


if __name__ == "__main__":
    main()
