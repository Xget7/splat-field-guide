# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy<2", "opencv-python-headless", "pillow", "scipy", "pyyaml"]
# ///
"""Checks for export.py: the maths on synthetic data, then the pack it wrote when there is one.

Run:  uv run export_checks.py [--pack ../data/pack/gol-trend-engine-bay/1] [--labels <labels.npy used for the pack>]
Exit code 1 when any check fails. Without a pack only the synthetic checks run, and the output says so.
The SPZ reader here is written from nianticlabs/spz load-spz.cc, not from export.py, so a shared mistake cannot hide.
"""

import argparse
import gzip
import io
import json
import math
import pathlib
import struct
import sys
import tempfile
import warnings

import numpy as np
import yaml
from PIL import Image, ImageOps

import export
import lift

warnings.filterwarnings("ignore", message=".*encountered in matmul")  # spurious with Accelerate, as in lift.py

HERE = pathlib.Path(__file__).parent
DATA = HERE.parent / "data"
PACK = DATA / "pack" / export.PACK_ID / str(export.PACK_VERSION)
results: list[tuple[bool, str]] = []
skipped: list[str] = []

SEED = 11
POSITION_TOLERANCE = 0.5 / (1 << export.SPZ_FRACTIONAL_BITS) + 1e-6   # half a fixed-point step
QUATERNION_TOLERANCE_RAD = 0.01                                        # 9-bit smallest-three
UP_RECOVERY_DEG = 2.0
GRAVITY_NOISE_DEG = 1.5       # per-photo accelerometer error in the synthetic sweeps, about the capture's spread
REAL_UP_ON_Y_DEG = 0.5        # the real photos' robust gravity lands this close to +Y in the pack
SH_CHECK_TOLERANCE = 1e-5
RENDER_FRAMES = (0, 40, 80, 120)
RENDER_SCALE = 1 / 8
RENDER_COLOUR_TOLERANCE = 0.03   # mean absolute colour difference over compared cells (colour is 0 to 1)
RENDER_COVERAGE_TOLERANCE = 0.01  # cells covered in only one of the two renders
BOUNDS_TOLERANCE = 1e-3
FULL_TURN_DEG, POLE_DEG = 360.0, 90.0      # parsePack's FULL_TURN_DEGREES and POLE_DEGREES
SPZ_DIMS = {0: 0, 1: 3, 2: 8, 3: 15, 4: 24}


def check(name: str):
    def wrap(fn):
        try:
            detail = fn()
            results.append((True, f"{name}{f': {detail}' if detail else ''}"))
        except Exception as e:  # a failed check is reported, never raised
            results.append((False, f"{name}: {type(e).__name__}: {e}"))
        return fn
    return wrap


# --- An independent SPZ reader, following load-spz.cc (version 1 to 3, gzip) ---

def read_spz(data: bytes) -> dict:
    raw = gzip.decompress(data)
    magic, version, n, degree, fractional_bits, flags, reserved = struct.unpack_from("<IIIBBBB", raw, 0)
    assert magic == 0x5053474E, "not NGSP"
    assert version in (2, 3), f"version {version}"
    assert flags == 0 and reserved == 0, "flags or reserved bits set"
    dim = SPZ_DIMS[degree]
    quat_bytes = 4 if version >= 3 else 3
    sizes = [("positions", n * 9), ("alphas", n), ("colours", n * 3), ("scales", n * 3),
             ("rotations", n * quat_bytes), ("sh", n * dim * 3)]
    assert len(raw) == 16 + sum(size for _, size in sizes), "trailing or missing bytes"
    blocks, offset = {}, 16
    for name, size in sizes:
        blocks[name] = np.frombuffer(raw, np.uint8, size, offset)
        offset += size
    fixed = blocks["positions"].reshape(n, 3, 3).astype(np.int64)
    fixed = fixed[..., 0] | fixed[..., 1] << 8 | fixed[..., 2] << 16
    fixed = np.where(fixed & 0x800000, fixed - (1 << 24), fixed)
    rot = blocks["rotations"].reshape(n, quat_bytes).astype(np.uint32)
    comp = rot[:, 0] + (rot[:, 1] << 8) + (rot[:, 2] << 16) + (rot[:, 3] << 24)
    largest = comp >> 30
    q, squares = np.zeros((n, 4)), np.zeros(n)
    for i in (3, 2, 1, 0):
        used = largest != i
        mag = (comp & 511).astype(np.float64)
        sign = np.where((comp >> 9) & 1, -1.0, 1.0)
        comp = np.where(used, comp >> 10, comp)
        q[:, i] = np.where(used, sign * math.sqrt(0.5) * mag / 511, 0.0)
        squares += q[:, i] ** 2
    q[np.arange(n), largest] = np.sqrt(1 - squares)
    alpha = blocks["alphas"].astype(np.float64) / 255
    with np.errstate(divide="ignore"):
        opacity = np.log(alpha / (1 - alpha))
    return {"degree": degree, "count": n, "version": version, "positions": fixed / (1 << fractional_bits),
            "alpha": alpha, "opacity": opacity, "dc": (blocks["colours"].reshape(n, 3) / 255 - 0.5) / 0.15,
            "log_scales": blocks["scales"].reshape(n, 3) / 16 - 10, "quats_xyzw": q,
            "sh": (blocks["sh"].reshape(n, dim, 3).astype(np.float64) - 128) / 128}


# --- Synthetic data ---

def random_rotation(rng) -> np.ndarray:
    q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
    return q * np.sign(np.linalg.det(q))


def random_cloud(rng, n: int, degree: int) -> dict:
    coeffs = (degree + 1) ** 2 - 1
    quats = rng.normal(size=(n, 4)).astype(np.float32)
    return {"positions": rng.uniform(-3, 3, (n, 3)).astype(np.float32),
            "log_scales": rng.uniform(-6, -2, (n, 3)).astype(np.float32),
            "quats_wxyz": quats / np.linalg.norm(quats, axis=1, keepdims=True),
            "opacity": rng.normal(size=n).astype(np.float32), "dc": rng.uniform(-1.5, 1.5, (n, 3)).astype(np.float32),
            "sh": rng.uniform(-0.6, 0.6, (n, coeffs, 3)).astype(np.float32), "degree": degree, "ply_degree": degree}


def matrix_from_quats(q: np.ndarray) -> np.ndarray:
    w, x, y, z = q.T
    return np.stack([np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], -1),
                     np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], -1),
                     np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1)], -2)


def angle_deg(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.degrees(np.arccos(np.clip(a @ b / np.linalg.norm(a) / np.linalg.norm(b), -1, 1))))


# --- Maths ---

def test_sh_basis_is_orthonormal():
    """The basis constants and the order stay those of 3DGS: real SH of bands 1 to 3 integrate to the identity."""
    nodes, weights = np.polynomial.legendre.leggauss(24)
    phi = np.arange(48) * 2 * np.pi / 48
    z, phi = np.meshgrid(nodes, phi, indexing="ij")
    r = np.sqrt(1 - z * z)
    d = np.stack([r * np.cos(phi), r * np.sin(phi), z], -1).reshape(-1, 3)
    w = np.repeat(weights, 48) * (2 * np.pi / 48)
    y = export.sh_basis(d, 3)
    gram = (y * w[:, None]).T @ y
    assert np.abs(gram - np.eye(15)).max() < 1e-9, f"deviation {np.abs(gram - np.eye(15)).max():.2g}"


def test_sh_rotation_preserves_colour():
    rng = np.random.default_rng(SEED)
    worst = 0.0
    for degree in (1, 2, 3):
        for _ in range(5):
            rotation, coefficients = random_rotation(rng), rng.normal(size=((degree + 1) ** 2 - 1, 3))
            m = export.sh_rotation(rotation, degree)
            assert np.abs(m @ m.T - np.eye(len(m))).max() < 1e-9, "the SH rotation is not orthogonal"
            d = rng.normal(size=(200, 3))
            d /= np.linalg.norm(d, axis=1, keepdims=True)
            before = export.sh_basis(d, degree) @ coefficients                         # colour along d
            after = export.sh_basis(d @ rotation.T, degree) @ (m @ coefficients)       # along the rotated direction
            worst = max(worst, float(np.abs(before - after).max()))
    assert worst < SH_CHECK_TOLERANCE, f"colour moved by {worst:.2g}"
    return f"worst difference {worst:.1e}"


def test_transform_follows_through():
    """The covariance of a splat after Placement.apply is scale^2 R Sigma R^T, and SH and positions follow."""
    rng = np.random.default_rng(SEED)
    cloud = random_cloud(rng, 50, 3)
    placement = export.Placement(random_rotation(rng), rng.normal(size=3), 0.37)
    moved = placement.apply(cloud)

    def covariance(c):
        r = matrix_from_quats(c["quats_wxyz"].astype(np.float64))
        s = np.exp(c["log_scales"].astype(np.float64))
        return np.einsum("nij,nj,nkj->nik", r, s * s, r)

    turn = placement.rotation
    expected = placement.scale ** 2 * np.einsum("ij,njk,lk->nil", turn, covariance(cloud), turn)
    assert np.abs(covariance(moved) - expected).max() < 1e-7, "covariance"
    assert np.abs(moved["positions"] - placement.scale * (cloud["positions"] - placement.origin) @ turn.T).max() < 1e-5
    # A view-dependent colour seen from a camera must not change when camera and splat move together.
    camera = rng.normal(size=3) * 10
    before = export.sh_basis(_unit(cloud["positions"] - camera), 3)[:, :, None] * cloud["sh"]
    after = export.sh_basis(_unit(moved["positions"] - placement.points(camera[None])[0]), 3)[:, :, None] * moved["sh"]
    assert np.abs(before.sum(1) - after.sum(1)).max() < 1e-4, "view-dependent colour changed"


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def test_display_axes_match_exif_transpose():
    """For each EXIF orientation, a stored pixel one step along the up (right) axis shows above (right of) centre."""
    w, h, step = 60, 40, 15
    for orientation in (1, 3, 6, 8):
        up, right = export.display_axes(orientation)
        for axis, expected in ((up, (0, -step)), (right, (step, 0))):
            raw = Image.new("L", (w, h))
            raw.putpixel((round(w / 2 + step * axis[0]), round(h / 2 + step * axis[1])), 255)
            exif = raw.getexif()
            exif[export.EXIF_ORIENTATION] = orientation
            buffer = io.BytesIO()
            raw.save(buffer, "PNG", exif=exif)
            shown = np.asarray(ImageOps.exif_transpose(Image.open(buffer)))
            v, u = np.argwhere(shown == 255)[0]
            offset = (u + 0.5 - shown.shape[1] / 2, v + 0.5 - shown.shape[0] / 2)
            assert max(abs(offset[0] - expected[0]), abs(offset[1] - expected[1])) <= 1.5, \
                f"orientation {orientation}: marker is {offset} from the centre of the photo, expected {expected}"


def synthetic_cameras(rng, up: np.ndarray, count: int, orientations: list[int],
                      pitch_deg: tuple[float, float]) -> tuple[list[tuple], list[int], np.ndarray]:
    """A sweep of cameras looking at the origin with pitches in `pitch_deg`, each stored with an EXIF orientation.

    Each carries the gravity its accelerometer would record, in device axes, off by about GRAVITY_NOISE_DEG.
    """
    e1 = np.cross(up, [1, 0, 0]) if abs(up[0]) < 0.9 else np.cross(up, [0, 1, 0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(up, e1)
    poses, chosen, gravity = [], [], []
    for i in range(count):
        azimuth, pitch = rng.uniform(-1, 1), np.radians(rng.uniform(*pitch_deg))
        position = -3 * (np.cos(pitch) * (np.cos(azimuth) * e1 + np.sin(azimuth) * e2) + np.sin(pitch) * up)
        forward = -position / np.linalg.norm(position)
        photo_up = up - (up @ forward) * forward            # the upright photo's up, perpendicular to the view
        photo_up /= np.linalg.norm(photo_up)
        photo_right = np.cross(forward, photo_up)
        orientation = orientations[i % len(orientations)]
        up_c, right_c = export.display_axes(orientation)     # the photo's up and right in the stored pixels' axes
        x_axis = up_c[0] * photo_up + right_c[0] * photo_right   # stored x (right) and y (down) in the world
        y_axis = up_c[1] * photo_up + right_c[1] * photo_right
        rotation = np.stack([x_axis, y_axis, forward])       # world to camera
        poses.append((rotation, -rotation @ position))
        chosen.append(orientation)
        noisy_up = _unit((rotation @ up + rng.normal(scale=np.radians(GRAVITY_NOISE_DEG), size=3))[None])[0]
        gravity.append(export.UP_FROM_DEVICE_GRAVITY.T @ noisy_up)
    return poses, chosen, np.stack(gravity)


def test_levelling_recovers_gravity():
    """Gravity is recovered however the photos pitch; the old mean display-up was off by their mean pitch."""
    rng = np.random.default_rng(SEED)
    for pitch_deg in ((-25, 25), (-85, -5), (-70, -50)):   # around the horizon, into an engine bay, steeply down
        up = _unit(rng.normal(size=(1, 3)))[0]
        poses, orientations, gravity = synthetic_cameras(rng, up, 400, [1, 3, 6, 8], pitch_deg)
        cameras = export.camera_geometry(poses, orientations, gravity)
        estimate, stats = export.estimate_up(cameras)
        assert angle_deg(estimate, up) < UP_RECOVERY_DEG, \
            f"pitches {pitch_deg}: off by {angle_deg(estimate, up):.1f} degrees"
        expected_pitch = np.mean(pitch_deg)
        assert abs(stats["median_pitch_deg"] - expected_pitch) < abs(pitch_deg[1] - pitch_deg[0]) / 4, \
            f"median pitch {stats['median_pitch_deg']:.0f} for pitches {pitch_deg}"
        rotation = export.level_rotation(estimate, cameras["forward"].mean(0))
        assert np.allclose(rotation @ rotation.T, np.eye(3)) and np.linalg.det(rotation) > 0, "not a proper rotation"
        assert np.abs(rotation @ estimate - [0, 1, 0]).max() < 1e-9, "up is not +Y"
    # A few photos with a wild reading must not drag the estimate.
    skewed = gravity.copy()
    skewed[:5] *= -1
    cameras = export.camera_geometry(poses, orientations, skewed)
    assert angle_deg(export.estimate_up(cameras)[0], up) < UP_RECOVERY_DEG, "outliers moved the estimate"
    # Wrong device mappings are refused. A flipped sign agrees with itself, so only the photos being upright catch it.
    for wrong, reasons in ((-gravity, ("above",)), (gravity @ np.diag([1.0, 1, -1]), ("spreads", "above"))):
        try:
            export.estimate_up(export.camera_geometry(poses, orientations, wrong))
        except AssertionError as e:
            assert any(r in str(e) for r in reasons), f"refused for another reason: {e}"
        else:
            raise AssertionError(f"a wrong device mapping was accepted (expected {reasons})")


def maker_note(entries: list[tuple[int, int, int, bytes]]) -> bytes:
    """An Apple MakerNote with these (tag, type, count, payload) entries, payloads stored after the directory."""
    head = export.APPLE_MAKER_NOTE + b"\0\x01MM"
    data_at = len(head) + 2 + 12 * len(entries) + 4
    directory, data = struct.pack(">H", len(entries)), b""
    for tag, kind, count, payload in entries:
        directory += struct.pack(">HHII", tag, kind, count, data_at + len(data))
        data += payload
    return head + directory + b"\0" * 4 + data


def test_apple_gravity_parses_a_maker_note():
    vector = struct.pack(">6i", 39, 1000, -737, 1000, -2061, 3000)
    note = maker_note([(0x0001, 9, 1, b"\0\0\0\x0e"), (export.APPLE_ACCELERATION, export.EXIF_SRATIONAL, 3, vector)])
    assert np.allclose(export.apple_gravity(note), [0.039, -0.737, -0.687]), export.apple_gravity(note)
    assert export.apple_gravity(maker_note([(0x0001, 9, 1, b"\0\0\0\x0e")])) is None, "found a vector in none"
    assert export.apple_gravity(b"Nikon\0" + note[6:]) is None, "read a note that is not Apple's"
    assert export.apple_gravity(b"") is None, "read an empty note"


def test_scale_from_a_battery():
    rng = np.random.default_rng(SEED)
    count, length, width, turn = 40000, 2.42, 1.75, math.radians(31)   # a 242 x 175 footprint in other units, turned
    flat = np.stack([rng.uniform(-length / 2, length / 2, count), rng.uniform(-width / 2, width / 2, count)], 1)
    rot = np.array([[math.cos(turn), -math.sin(turn)], [math.sin(turn), math.cos(turn)]])
    flat = flat @ rot.T
    found = export.estimate_scale(np.stack([flat[:, 0], rng.uniform(0, 1, count), flat[:, 1]], 1))
    expected = length * (1 - 2 * export.EXTENT_PERCENTILE / 100)  # percentile extents trim a little of a uniform box
    assert abs(found["longest"] - expected) / expected < 0.02, f"longest side {found['longest']:.3f} not {expected:.3f}"
    assert abs(found["aspect"] - export.BATTERY_ASPECT) < 0.05, f"aspect {found['aspect']:.2f}"


# --- SPZ and labels ---

def test_spz_round_trip_synthetic():
    rng = np.random.default_rng(SEED)
    for degree in (0, 1, 2, 3):
        cloud = random_cloud(rng, 3000, degree)
        cloud["positions"][:5] = [[-2000, 0, 2000]] * 5  # far corners of the fixed-point range
        with tempfile.TemporaryDirectory() as folder:
            export.write_spz(pathlib.Path(folder) / "cloud.spz", cloud)
            back = read_spz((pathlib.Path(folder) / "cloud.spz").read_bytes())
        compare_clouds(cloud, back)
    return "degrees 0 to 3"


def compare_clouds(cloud: dict, back: dict) -> str:
    n = len(cloud["positions"])
    assert back["count"] == n and back["degree"] == cloud["degree"] and back["version"] == export.SPZ_VERSION
    assert np.abs(back["positions"] - cloud["positions"]).max() <= POSITION_TOLERANCE, "positions"
    alpha = 1 / (1 + np.exp(-cloud["opacity"].astype(np.float64)))
    assert np.abs(back["alpha"] - alpha).max() <= 0.5 / 255 + 1e-6, "alphas"
    in_range = np.abs(cloud["dc"] * 0.15 * 255) <= 127
    assert np.abs(back["dc"] - cloud["dc"])[in_range].max() <= 0.5 / (255 * 0.15) + 1e-6, "colours"
    in_range = (cloud["log_scales"] > -10) & (cloud["log_scales"] < 5.9)
    assert np.abs(back["log_scales"] - cloud["log_scales"])[in_range].max() <= 0.5 / 16 + 1e-6, "scales"
    q = cloud["quats_wxyz"][:, [1, 2, 3, 0]].astype(np.float64)
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    angle = 2 * np.arccos(np.clip(np.abs((q * back["quats_xyzw"]).sum(1)), 0, 1))
    assert angle.max() < QUATERNION_TOLERANCE_RAD, f"rotations off by {angle.max():.4f} rad"
    assert np.abs(np.linalg.norm(back["quats_xyzw"], axis=1) - 1).max() < 1e-6, "rotations are not unit"
    if cloud["degree"]:
        bucket = np.full((cloud["sh"].shape[1], 1), 1 << (8 - export.SPZ_SH_REST_BITS))
        bucket[:3] = 1 << (8 - export.SPZ_SH1_BITS)
        inside = np.abs(cloud["sh"]) < 1 - bucket / 128   # the top bucket clips instead of rounding
        limit = ((bucket / 2 + 0.5) / 128)[None] + 1e-6   # half a bucket plus the 8 bit rounding
        assert (np.abs(back["sh"] - cloud["sh"])[inside] <= np.broadcast_to(limit, inside.shape)[inside]).all(), "SH"
    return f"{n:,} splats"


def test_labels_bin_layout():
    rng = np.random.default_rng(SEED)
    labels = rng.integers(0, 9, 1234).astype(np.uint8)
    with tempfile.TemporaryDirectory() as folder:
        export.write_labels(pathlib.Path(folder) / "labels.bin", labels)
        raw = (pathlib.Path(folder) / "labels.bin").read_bytes()
    assert raw[:4] == b"SFGL" and len(raw) == 16 + len(labels), "header or length"
    assert struct.unpack("<HHII", raw[4:16]) == (1, 1, len(labels), 0), "header fields"
    assert np.array_equal(np.frombuffer(raw, np.uint8, offset=16), labels), "labels"


# --- A Python mirror of parsePack's checks (apps/field-guide/src/domain/parsePack.ts) ---

class PackError(Exception):
    def __init__(self, code: str, path: str):
        super().__init__(f"{code} at {path or 'root'}")
        self.code, self.path = code, path


def parse_pack(root):
    def obj(v, p):
        if not isinstance(v, dict):
            raise PackError("invalidField", p)
        return v

    def arr(v, p):
        if not isinstance(v, list):
            raise PackError("invalidField", p)
        return v

    def text(v, p):
        if not isinstance(v, str):
            raise PackError("invalidField", p)
        return v

    def name(v, p):
        if not text(v, p).strip():
            raise PackError("invalidField", p)
        return v

    def num(v, p):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise PackError("invalidField", p)
        return v

    def count(v, p):
        if num(v, p) != int(v) or v < 0:
            raise PackError("invalidField", p)
        return v

    def vec3(v, p):
        items = arr(v, p)
        if len(items) != 3:
            raise PackError("invalidField", p)
        return [num(x, f"{p}[{i}]") for i, x in enumerate(items)]

    def file(v, p):
        v = obj(v, p)
        name(v.get("path"), f"{p}.path"), count(v.get("bytes"), f"{p}.bytes"), text(v.get("sha256"), f"{p}.sha256")

    root = obj(root, "")
    if num(root.get("schemaVersion"), "schemaVersion") != 1:
        raise PackError("unsupportedSchemaVersion", "schemaVersion")
    tiers = arr(root.get("tiers"), "tiers")
    for i, tier in enumerate(tiers):
        tier = obj(tier, f"tiers[{i}]")
        name(tier.get("id"), f"tiers[{i}].id"), count(tier.get("splatCount"), f"tiers[{i}].splatCount")
        file(tier.get("cloud"), f"tiers[{i}].cloud"), file(tier.get("labels"), f"tiers[{i}].labels")
    if not tiers:
        raise PackError("invalidField", "tiers")
    parts = arr(root.get("parts"), "parts")
    for i, part in enumerate(parts):
        p = f"parts[{i}]"
        part = obj(part, p)
        name(part.get("id"), f"{p}.id")
        label = num(part.get("label"), f"{p}.label")
        if label != int(label) or not 1 <= label <= 255:
            raise PackError("labelOutOfRange", f"{p}.label")
        if part.get("parent") is not None:
            name(part["parent"], f"{p}.parent")
        name(part.get("name"), f"{p}.name")
        for k, alias in enumerate(arr(part.get("aliases", []), f"{p}.aliases")):
            name(alias, f"{p}.aliases[{k}]")
        for key in ("summary", "details"):
            text(part.get(key, ""), f"{p}.{key}")
        bounds = obj(part.get("bounds"), f"{p}.bounds")
        low, high = vec3(bounds.get("min"), f"{p}.bounds.min"), vec3(bounds.get("max"), f"{p}.bounds.max")
        if any(a > b for a, b in zip(low, high)):
            raise PackError("invalidField", f"{p}.bounds")
        vec3(part.get("anchor"), f"{p}.anchor")
    procedures = arr(root.get("procedures"), "procedures")
    for i, procedure in enumerate(procedures):
        p = f"procedures[{i}]"
        procedure = obj(procedure, p)
        name(procedure.get("id"), f"{p}.id"), name(procedure.get("title"), f"{p}.title")
        steps = arr(procedure.get("steps"), f"{p}.steps")
        if not steps:
            raise PackError("invalidField", f"{p}.steps")
        for k, step in enumerate(steps):
            s = f"{p}.steps[{k}]"
            step = obj(step, s)
            name(step.get("id"), f"{s}.id"), text(step.get("text"), f"{s}.text")
            text(step.get("caution", ""), f"{s}.caution")
            for j, part in enumerate(arr(step.get("parts"), f"{s}.parts")):
                name(part, f"{s}.parts[{j}]")
    camera = obj(root.get("camera"), "camera")
    for group, keys in (("home", ("azimuth", "elevation", "radius")),
                        ("limits", ("minAzimuth", "maxAzimuth", "minElevation", "maxElevation", "minRadius",
                                    "maxRadius"))):
        for key in keys:
            num(obj(camera.get(group), f"camera.{group}").get(key), f"camera.{group}.{key}")
    check_camera(camera["home"], camera["limits"])
    name(root.get("packId"), "packId"), count(root.get("packVersion"), "packVersion"), name(root.get("title"), "title")
    ids, labels = set(), set()
    for i, part in enumerate(parts):
        if part["id"] in ids:
            raise PackError("duplicatePartId", f"parts[{i}].id")
        ids.add(part["id"])
        if part["label"] in labels:
            raise PackError("duplicatePartLabel", f"parts[{i}].label")
        labels.add(part["label"])
    parent_of = {p["id"]: p.get("parent") for p in parts}
    for i, part in enumerate(parts):
        if part.get("parent") is not None and part["parent"] not in ids:
            raise PackError("unknownParent", f"parts[{i}].parent")
    for i, part in enumerate(parts):
        walked, nxt = {part["id"]}, part.get("parent")
        while nxt is not None:
            if nxt in walked:
                raise PackError("parentCycle", f"parts[{i}].parent")
            walked.add(nxt)
            nxt = parent_of.get(nxt)
    procedure_ids = set()
    for i, procedure in enumerate(procedures):
        if procedure["id"] in procedure_ids:
            raise PackError("duplicateProcedureId", f"procedures[{i}].id")
        procedure_ids.add(procedure["id"])
        step_ids = set()
        for k, step in enumerate(procedure["steps"]):
            if step["id"] in step_ids:
                raise PackError("duplicateStepId", f"procedures[{i}].steps[{k}].id")
            step_ids.add(step["id"])
            for j, part in enumerate(step["parts"]):
                if part not in ids:
                    raise PackError("unknownStepPart", f"procedures[{i}].steps[{k}].parts[{j}]")


def check_camera(home: dict, limits: dict):
    """parsePack's checkCamera: limits in order and in range, and the home inside them."""
    def invalid(where: str):
        raise PackError("invalidField", where)

    for key in ("minAzimuth", "maxAzimuth"):
        if abs(limits[key]) > FULL_TURN_DEG:
            invalid(f"camera.limits.{key}")
    if limits["minAzimuth"] >= limits["maxAzimuth"] or limits["maxAzimuth"] - limits["minAzimuth"] > FULL_TURN_DEG:
        invalid("camera.limits.maxAzimuth")
    for key in ("minElevation", "maxElevation"):
        if abs(limits[key]) >= POLE_DEG:
            invalid(f"camera.limits.{key}")
    if limits["minElevation"] > limits["maxElevation"]:
        invalid("camera.limits.maxElevation")
    if limits["minRadius"] <= 0:
        invalid("camera.limits.minRadius")
    if limits["minRadius"] > limits["maxRadius"]:
        invalid("camera.limits.maxRadius")
    for key, name in (("azimuth", "Azimuth"), ("elevation", "Elevation"), ("radius", "Radius")):
        if not limits[f"min{name}"] <= home[key] <= limits[f"max{name}"]:
            invalid(f"camera.home.{key}")


def sample_manifest() -> dict:
    content = yaml.safe_load(export.CONTENT.read_text())
    zero = {"bounds": {"min": [0.0] * 3, "max": [1.0] * 3}, "anchor": [0.0, 1.0, 0.0]}
    entry = {"path": "x", "bytes": 1, "sha256": ""}
    return {"schemaVersion": 1, "packId": "p", "packVersion": 1, "title": "t",
            "tiers": [{"id": "high", "splatCount": 1, "cloud": entry, "labels": entry}],
            "camera": {"home": {"azimuth": 0, "elevation": 35, "radius": 1.2},
                       "limits": {"minAzimuth": -90, "maxAzimuth": 90, "minElevation": 10, "maxElevation": 80,
                                  "minRadius": 0.25, "maxRadius": 2.5}},
            "parts": [{"id": p["id"], "label": i + 1, "parent": p["parent"], "name": p["name"],
                       "aliases": p["aliases"], "summary": p["summary"], "details": p["details"], **zero}
                      for i, p in enumerate(content["parts"])],
            "procedures": content["procedures"]}


def test_manifest_mirror():
    import copy

    good = sample_manifest()
    parse_pack(good)

    def broken(mutate, code):
        bad = copy.deepcopy(good)
        mutate(bad)
        try:
            parse_pack(bad)
        except PackError as e:
            assert e.code == code, f"{code} expected, got {e.code}"
            return
        raise AssertionError(f"{code} was accepted")

    broken(lambda m: m.update(schemaVersion=2), "unsupportedSchemaVersion")
    broken(lambda m: m["parts"][1].update(label=m["parts"][0]["label"]), "duplicatePartLabel")
    broken(lambda m: m["parts"][0].update(label=0), "labelOutOfRange")
    broken(lambda m: m["parts"][0].update(parent="nope"), "unknownParent")
    broken(lambda m: m["parts"][0].update(bounds={"min": [1, 1, 1], "max": [0, 0, 0]}), "invalidField")
    broken(lambda m: m["camera"]["limits"].pop("minAzimuth"), "invalidField")
    broken(lambda m: m["camera"]["limits"].update(minAzimuth=90, maxAzimuth=-90), "invalidField")
    broken(lambda m: m["camera"]["limits"].update(minAzimuth=-181, maxAzimuth=180), "invalidField")
    broken(lambda m: m["camera"]["home"].update(azimuth=120), "invalidField")
    broken(lambda m: m["camera"]["home"].update(elevation=5), "invalidField")
    broken(lambda m: m["camera"]["limits"].update(maxElevation=90), "invalidField")
    broken(lambda m: m["camera"]["limits"].update(minRadius=0), "invalidField")
    full_turn = copy.deepcopy(good)
    full_turn["camera"]["limits"].update(minAzimuth=-180, maxAzimuth=180)
    parse_pack(full_turn)
    broken(lambda m: m["procedures"][0]["steps"][0].update(parts=["nope"]), "unknownStepPart")
    broken(lambda m: m["parts"][5].update(parent="valve-cover"), "parentCycle")


# --- The pack on disk ---

def load_pack(pack: pathlib.Path):
    manifest = json.loads((pack / "manifest.json").read_text())
    report = json.loads((pack.parent / f"{pack.name}.report.json").read_text())
    return manifest, report


def test_manifest_against_files(pack: pathlib.Path):
    manifest, _ = load_pack(pack)
    parse_pack(manifest)
    content = yaml.safe_load(export.CONTENT.read_text())
    tier = manifest["tiers"][0]
    for key in ("cloud", "labels"):
        path = pack / tier[key]["path"]
        assert path.stat().st_size == tier[key]["bytes"], f"{key} byte count"
        assert export.sha256(path) == tier[key]["sha256"], f"{key} sha256"
    assert [p["id"] for p in manifest["parts"]] == [p["id"] for p in content["parts"]], "part order"
    numbers = list(range(1, len(content["parts"]) + 1))
    assert [p["label"] for p in manifest["parts"]] == numbers, "labels are 1-based in part order"
    for part, authored in zip(manifest["parts"], content["parts"]):
        for key in ("name", "parent", "aliases", "summary", "details"):
            assert part[key] == authored[key], f"{part['id']}.{key} differs from pack.yaml"
    assert manifest["procedures"] == content["procedures"], "procedures differ from pack.yaml"
    identity = (manifest["schemaVersion"], manifest["packId"], manifest["packVersion"])
    assert identity == (1, export.PACK_ID, export.PACK_VERSION)
    camera = manifest["camera"]
    home, limits = camera["home"], camera["limits"]
    check_camera(home, limits)
    return f"{len(manifest['parts'])} parts, {tier['splatCount']:,} splats"


def test_pack_files(pack: pathlib.Path, label_path: pathlib.Path | None, mask_part: str):
    """The SPZ decodes; labels.bin has the spec header and is the input labels cropped the way the report says."""
    manifest, report = load_pack(pack)
    tier = manifest["tiers"][0]
    decoded = read_spz((pack / tier["cloud"]["path"]).read_bytes())
    assert decoded["count"] == tier["splatCount"], "SPZ count differs from the manifest"
    raw = (pack / tier["labels"]["path"]).read_bytes()
    header = struct.unpack("<HHII", raw[4:16])
    assert raw[:4] == b"SFGL" and header == (1, 1, tier["splatCount"], 0), "labels.bin header"
    assert len(raw) == 16 + tier["splatCount"], "labels.bin length"
    labels = np.frombuffer(raw, np.uint8, offset=16)
    assert labels.max() <= len(manifest["parts"]), "a label no part carries"

    # Recompute the crop from the PLY and the recorded placement: same count, same splats, same labels.
    splat, _ = lift.read_ply(lift.SPLAT)
    place = report["placement"]
    placement = export.Placement(np.array(place["rotation"]), np.array(place["origin"]), place["scale"])
    placed = placement.points(np.stack([np.asarray(splat[k], np.float64) for k in "xyz"], 1))
    low, high = np.array(report["crop"]["min"]), np.array(report["crop"]["max"])
    keep = np.flatnonzero(((placed >= low) & (placed <= high)).all(1))
    assert len(keep) == decoded["count"], f"{len(keep):,} splats in the crop box, {decoded['count']:,} in the SPZ"
    detail = f"{decoded['count']:,} splats"
    if label_path:
        source = export.read_labels(label_path, len(splat), [p["id"] for p in manifest["parts"]], mask_part)
        assert np.array_equal(source[keep], labels), "labels.bin is not the input labels in SPZ order"
        detail += f", labels match {label_path.name}"
    else:
        skipped.append("labels.bin against the input labels (pass --labels)")
    compare_clouds(placement.apply(export.load_splats(splat, keep, decoded["degree"])), decoded)
    return detail, decoded, keep, labels, splat, placement, report


def test_bounds_and_anchors(pack: pathlib.Path, decoded: dict, labels: np.ndarray):
    manifest, _ = load_pack(pack)
    parts = manifest["parts"]
    children = {p["id"]: [c["label"] for c in parts if c["parent"] == p["id"]] for p in parts}
    empty = []
    for part in parts:
        mine = decoded["positions"][np.isin(labels, [part["label"]] + children[part["id"]])]
        if len(mine) == 0:
            empty.append(part["id"])
            continue
        lo, hi = np.percentile(mine, [2, 98], axis=0)
        assert np.abs(lo - part["bounds"]["min"]).max() < BOUNDS_TOLERANCE + POSITION_TOLERANCE, f"{part['id']} min"
        assert np.abs(hi - part["bounds"]["max"]).max() < BOUNDS_TOLERANCE + POSITION_TOLERANCE, f"{part['id']} max"
        low, high, anchor = part["bounds"]["min"], part["bounds"]["max"], part["anchor"]
        assert abs(anchor[1] - high[1]) < 2 * BOUNDS_TOLERANCE, f"{part['id']} anchor is not on top"
        assert all(a <= b <= c for a, b, c in zip(low, anchor, high)), f"{part['id']} anchor is outside its bounds"
    return f"{len(parts) - len(empty)} parts measured" + (f", no splats for {empty}" if empty else "")


def test_levelling_of_the_real_photos(report: dict):
    """In the pack's frame the photos' recorded gravity is +Y, the frame is right-handed and the scale is recorded."""
    rotation = np.array(report["placement"]["rotation"])
    assert np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-9), "not orthonormal"
    assert np.linalg.det(rotation) > 0, "mirrored"
    photos = sorted(lift.PHOTOS.glob("*.jpg"))
    poses = [lift.read_cameras(lift.SPARSE)[p.name] for p in photos]
    cameras = export.camera_geometry(poses, export.read_orientations(photos), export.read_device_gravity(photos))
    up, stats = export.estimate_up(cameras)
    robust = angle_deg(rotation @ up, np.array([0.0, 1, 0]))
    assert robust < REAL_UP_ON_Y_DEG, f"the photos' gravity is {robust:.2f} degrees off +Y"
    scale = report["scale"]
    unit = "metres" if scale["metric"] else "COLMAP units, battery not labelled"
    return (f"gravity {robust:.2f} degrees off +Y, photos agree to {stats['median_deviation_deg']:.1f} degrees, "
            f"median pitch {stats['median_pitch_deg']:.0f}; scale {scale['scale']:.4g} ({unit})")


def view_dependent_colour(cloud: dict, centre: np.ndarray, index: np.ndarray) -> np.ndarray:
    sh = cloud["sh"][index]
    direction = _unit(cloud["positions"][index] - centre)
    colour = 0.5 + lift.SH_C0 * cloud["dc"][index]
    if cloud["degree"]:
        colour = colour + np.einsum("nk,nkc->nc", export.sh_basis(direction, cloud["degree"]), sh)
    return np.clip(colour, 0, 1)


def composite_view(cloud: dict, alpha: np.ndarray, rotation, translation, camera):
    width, height, _ = camera
    w, h = round(width * RENDER_SCALE), round(height * RENDER_SCALE)
    u, v, z = lift.project(cloud["positions"].astype(np.float64), rotation, translation, camera, RENDER_SCALE)
    index, _, _, cell, weight = lift.contributions(u, v, z, alpha, w, h)
    centre = -rotation.T @ translation
    colour = view_dependent_colour(cloud, centre, index)
    return lift.composite(colour, cell, weight, w, h)


def test_render_matches_original(decoded: dict, keep: np.ndarray, splat, placement, report):
    """The same photo composited from the original splats and from the decoded pack agrees up to quantisation."""
    photos = sorted(lift.PHOTOS.glob("*.jpg"))
    cameras = lift.read_cameras(lift.SPARSE)
    source = export.load_splats(splat, keep, decoded["degree"])
    source_alpha = 1 / (1 + np.exp(-source["opacity"].astype(np.float64)))
    keys = ("positions", "dc", "sh", "degree")
    exported = {k: decoded[k] for k in keys}
    unrotated = {**exported, "sh": source["sh"]}   # what the export would look like if the SH were not rotated
    details = []
    for frame in RENDER_FRAMES:
        rotation, translation, camera = cameras[photos[frame].name]
        new_rotation, new_translation = placement.camera(rotation, translation)
        a = composite_view({k: source[k] for k in keys}, source_alpha, rotation, translation, camera)
        b = composite_view(exported, decoded["alpha"], new_rotation, new_translation, camera)
        wrong = composite_view(unrotated, decoded["alpha"], new_rotation, new_translation, camera)
        known_a, known_b = ~np.isnan(a[..., 0]), ~np.isnan(b[..., 0])
        both = known_a & known_b
        coverage = float((known_a ^ known_b).sum() / max(known_a.sum(), 1))
        error = float(np.abs(a[both] - b[both]).mean())
        wrong_error = float(np.abs(a[both] - wrong[both]).mean())
        assert coverage < RENDER_COVERAGE_TOLERANCE, f"photo {frame + 1}: {coverage:.3f} of the cells differ in cover"
        assert error < RENDER_COLOUR_TOLERANCE, f"photo {frame + 1}: mean colour difference {error:.4f}"
        assert error < wrong_error, f"photo {frame + 1}: rotated SH {error:.4f} vs unrotated {wrong_error:.4f}"
        details.append(f"{error:.4f} vs {wrong_error:.4f} unrotated")
    return "mean colour difference per photo: " + ", ".join(details)


# The checks that need no pack, which preflight.py runs too.
SYNTHETIC_CHECKS = [("SH basis is orthonormal", test_sh_basis_is_orthonormal),
                    ("SH rotation preserves the colour along rotated directions", test_sh_rotation_preserves_colour),
                    ("rotation, scale and positions follow the transform", test_transform_follows_through),
                    ("display axes match EXIF orientation", test_display_axes_match_exif_transpose),
                    ("levelling recovers gravity", test_levelling_recovers_gravity),
                    ("Apple MakerNote acceleration vector", test_apple_gravity_parses_a_maker_note),
                    ("scale from a battery", test_scale_from_a_battery),
                    ("SPZ round trip, synthetic", test_spz_round_trip_synthetic),
                    ("labels.bin layout", test_labels_bin_layout),
                    ("manifest mirror rejects what parsePack rejects", test_manifest_mirror)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", type=pathlib.Path, default=PACK)
    parser.add_argument("--labels", type=pathlib.Path, help="the labels.npy the pack was made from")
    parser.add_argument("--mask-part", default="engine")
    args = parser.parse_args()

    for name, fn in SYNTHETIC_CHECKS:
        check(name)(fn)

    if (args.pack / "manifest.json").exists():
        check("manifest matches pack.yaml and the files")(lambda: test_manifest_against_files(args.pack))
        loaded = {}

        def pack_files():
            detail, *rest = test_pack_files(args.pack, args.labels, args.mask_part)
            loaded["rest"] = rest
            return detail

        check("SPZ and labels.bin match the PLY, the placement and the labels")(pack_files)
        if "rest" in loaded:
            decoded, keep, labels, splat, placement, report = loaded["rest"]
            check("part bounds and anchors match the decoded splats")(
                lambda: test_bounds_and_anchors(args.pack, decoded, labels))
            check("the real photos are levelled")(lambda: test_levelling_of_the_real_photos(report))
            check("render matches the original PLY")(
                lambda: test_render_matches_original(decoded, keep, splat, placement, report))
    else:
        skipped.append(f"every check on the pack (no {args.pack / 'manifest.json'}; run export.py first)")

    for ok, line in results:
        print(f"{'PASS' if ok else 'FAIL'}  {line}")
    for line in skipped:
        print(f"skip  {line}")
    sys.exit(0 if all(ok for ok, _ in results) else 1)


if __name__ == "__main__":
    main()
