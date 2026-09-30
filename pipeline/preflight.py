# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy<2", "opencv-python-headless", "pillow", "modal", "fastapi", "httpx2", "uvicorn", "scipy", "pyyaml"]
# ///
"""Everything that can be checked without a GPU, before a SAM run is sent to Modal.

Run:  uv run preflight.py [--clicks prompts-v1.json] [--volume]
      uv run preflight.py --serve-fake     (the marking page on http://127.0.0.1:8765 with a fake SAM)
Exit code 1 when any check fails; preflight/clicks.jpg shows every click where SAM will see it.
"""

import argparse
import io
import json
import pathlib
import py_compile
import re
import subprocess
import sys
import tempfile

import cv2
import numpy as np
from PIL import Image, ImageOps

import spike_lib

HERE = pathlib.Path(__file__).parent
DATA = HERE.parent / "data"
PHOTOS = DATA / "capture" / "jpg"
OUT = DATA / "preflight"
SUPPORTED_ORIENTATIONS = {1, 3, 6, 8}
results: list[tuple[bool, str]] = []


def check(name: str):
    def wrap(fn):
        try:
            detail = fn()
            results.append((True, f"{name}{f': {detail}' if detail else ''}"))
        except Exception as e:  # a failed check is reported, never raised
            results.append((False, f"{name}: {e}"))
        return fn
    return wrap


def test_code_compiles():
    sources = ["sam_clicks.py", "sam_live.py", "sam_track.py", "live_api.py", "spike_lib.py", "lift.py", "lift_all.py",
               "export.py", "export_checks.py", "preflight.py"]
    for file in sources:
        py_compile.compile(str(HERE / file), doraise=True)
    lint = subprocess.run(["uvx", "ruff", "check", "--quiet", "--select", "F,E9", *sources],
                          cwd=HERE, capture_output=True, text=True)
    assert lint.returncode == 0, lint.stdout.strip() or lint.stderr.strip()


def test_modal_app_builds():
    sys.path.insert(0, str(HERE))
    import sam_clicks  # noqa: F401  (defines the image and function without contacting Modal)
    import sam_live
    import sam_track

    assert callable(sam_clicks.main)
    sam = sam_live.Sam()  # the web function calls these by name, so a rename must fail here, not on Modal
    missing = [m for m in ("warm", "segment", "save") if not hasattr(sam, m)]
    assert not missing, f"sam_live.Sam lacks {missing}"
    assert sam_track.DEFAULT_VARIANT in sam_track.VARIANTS
    assert {order for order, _ in sam_track.VARIANTS.values()} == {"capture", "view"}


def test_orientation_matches_what_the_browser_shows():
    """For every EXIF orientation, a click on the upright photo must land on the same stored pixel."""
    w, h = 40, 30
    for orientation in SUPPORTED_ORIENTATIONS:
        raw = Image.new("L", (w, h))
        raw.putpixel((31, 7), 255)
        exif = raw.getexif()
        exif[274] = orientation
        buffer = io.BytesIO()
        raw.save(buffer, "PNG", exif=exif)
        shown = np.asarray(ImageOps.exif_transpose(Image.open(buffer)))  # what Chrome displays
        v, u = np.argwhere(shown == 255)[0]
        x, y = spike_lib.raw_from_display((u + 0.5) / shown.shape[1], (v + 0.5) / shown.shape[0], orientation)
        assert (int(x * w), int(y * h)) == (31, 7), f"orientation {orientation} maps to {(int(x * w), int(y * h))}"


def test_marks_checks_catch_bad_marks():
    parts = {"body": {"parent": None}, "cap": {"parent": "body"}, "lid": {"parent": None}}
    shape = (20, 30)

    def box(top, left, bottom, right):
        mask = np.zeros(shape, bool)
        mask[top:bottom, left:right] = True
        return mask

    def saved(**masks):
        return {part: {"marks": {"part": part, "photos": {str(f): {} for f in by_photo}}, "masks": by_photo}
                for part, by_photo in masks.items()}

    good = saved(body={0: box(2, 2, 18, 20), 1: box(2, 2, 18, 20)}, cap={1: box(4, 4, 8, 8)}, lid={1: box(2, 22, 18, 28)})
    assert spike_lib.check_marks(good, lambda f: shape, parts) == []
    wrong_part = saved(body=good["body"]["masks"], cap=good["cap"]["masks"], lid=good["lid"]["masks"])
    wrong_part["lid"]["marks"]["part"] = "body"
    unlisted = saved(body=good["body"]["masks"], cap=good["cap"]["masks"], lid=good["lid"]["masks"])
    unlisted["body"]["marks"]["photos"].pop("0")
    bad = {
        "missing part": {p: good[p] for p in ("body", "cap")},
        "unknown part": {**good, **saved(hood={0: box(2, 2, 9, 9)})},
        "marks.json names another part": wrong_part,
        "marks.json and masks disagree": unlisted,
        "no masks": {**good, **saved(lid={})},
        "wrong size": {**good, **saved(lid={1: np.ones((30, 20), bool)})},
        "empty mask": {**good, **saved(lid={1: np.zeros(shape, bool)})},
        "whole photo": {**good, **saved(lid={1: np.ones(shape, bool)})},
        "child outside its parent": {**good, **saved(cap={1: box(2, 22, 6, 26)})},
        "siblings claim the same pixels": {**good, **saved(lid={1: box(4, 4, 16, 18)})},
    }
    for case, marks in bad.items():
        assert spike_lib.check_marks(marks, lambda f: shape, parts), f"{case} passed"


def test_prompt_checks_catch_bad_files():
    names = ["a.jpg", "b.jpg"]
    good = {"frames": names, "parts": [{"id": "cap", "clicks": [{"frame": 1, "photo": "b.jpg", "x": .5, "y": .5, "positive": True}]}]}
    assert spike_lib.check_prompts(good, names)[0] == []
    bad = [
        {**good, "frames": ["b.jpg", "a.jpg"]},
        {**good, "parts": [{"id": "cap", "clicks": [{"frame": 1, "x": .5, "y": .5, "positive": False}]}]},
        {**good, "parts": [{"id": "cap", "clicks": [{"frame": 9, "x": .5, "y": .5, "positive": True}]}]},
        {**good, "parts": [{"id": "cap", "clicks": [{"frame": 0, "photo": "b.jpg", "x": .5, "y": .5, "positive": True}]}]},
        {**good, "parts": [{"id": "cap", "clicks": [{"frame": 0, "x": 1.2, "y": .5, "positive": True}]}]},
    ]
    for i, prompts in enumerate(bad):
        assert spike_lib.check_prompts(prompts, names)[0], f"bad case {i} passed"


def test_contact_sheet_edge_cases():
    photo = np.full((30, 40, 3), 90, np.uint8)
    prompts = {"parts": [{"id": "cap", "clicks": [{"frame": 0, "x": .5, "y": .5, "positive": True}]}]}
    colours = {"cap": (0, 140, 255)}
    mask = np.zeros((30, 40), bool)
    mask[10:20, 10:20] = True
    cases = [
        ([], {}, {}),                                   # nothing found at all (the run that crashed)
        ([0, 1], {"cap": {0: mask}}, {0: 6, 1: 1}),     # a frame without a mask, mixed orientations
    ]
    for frames, masks, orientations in cases:
        jpg = spike_lib.contact_sheet(lambda f: photo, frames, masks, colours, prompts, orientations)
        assert cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR) is not None


def test_mask_orientation_matches_the_photo():
    """A mask drawn on the upright photo must land on the same stored pixels, for every EXIF orientation."""
    raw = np.zeros((30, 40), bool)
    raw[3:9, 25:37] = True
    for orientation in SUPPORTED_ORIENTATIONS:
        image = Image.fromarray(raw.astype(np.uint8) * 255)
        exif = image.getexif()
        exif[274] = orientation
        buffer = io.BytesIO()
        image.save(buffer, "PNG", exif=exif)
        shown = np.asarray(ImageOps.exif_transpose(Image.open(buffer))) > 0
        back = spike_lib.raw_from_display_mask(shown, orientation)
        assert back.shape == raw.shape and (back == raw).all(), f"orientation {orientation} does not round-trip"


def test_working_photo_matches_tracker_frames():
    """The page's upright photo, turned back, is exactly the frame the tracker reads (same size, no resampling drift)."""
    name = sorted(PHOTOS.glob("*.jpg"))[spike_lib.KEYFRAMES[0]]
    upright = spike_lib.working_photo(Image.open(name))
    stored = Image.open(name)
    stored.thumbnail((spike_lib.WORKING_SIDE, spike_lib.WORKING_SIDE))
    back = spike_lib.raw_from_display_mask(np.zeros((upright.height, upright.width), bool), stored.getexif().get(274, 1))
    assert back.shape == (stored.height, stored.width), f"{back.shape} vs {(stored.height, stored.width)}"
    return f"{upright.size} upright, {stored.size} stored"


def test_page_script_parses():
    page = (HERE / "mark.html").read_text()
    script = re.search(r"<script>(.*)</script>", page, re.S).group(1)
    with tempfile.NamedTemporaryFile("w", suffix=".js") as js:
        js.write(script)
        js.flush()
        result = subprocess.run(["node", "--check", js.name], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr.strip()


class FakeSam:
    """Stands in for SAM behind the real web API: discs around the clicks, clipped to the box."""

    def __init__(self, out: pathlib.Path):
        self.out = out
        names = sorted(p.name for p in PHOTOS.glob("*.jpg"))
        self.sizes, self.orientations = {}, {}
        for frame in spike_lib.photos_to_mark():
            photo = Image.open(PHOTOS / names[frame])
            self.orientations[frame] = photo.getexif().get(274, 1)
            self.sizes[frame] = spike_lib.working_photo(photo).size

    def mask(self, frame, marks):
        w, h = self.sizes[frame]
        prompt = spike_lib.sam_prompt(marks, w, h)
        if prompt is None:
            return None, 0.0
        yy, xx = np.mgrid[0:h, 0:w]
        mask = np.zeros((h, w), bool)
        if prompt["point_coords"] is not None:
            for (x, y), label in zip(prompt["point_coords"], prompt["point_labels"]):
                disc = (xx - x) ** 2 + (yy - y) ** 2 <= (w * (0.12 if label else 0.06)) ** 2
                mask = mask | disc if label else mask & ~disc
        if prompt["box"] is not None:
            x0, y0, x1, y1 = prompt["box"]
            inside = (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
            mask = (mask & inside) if mask.any() else inside
        return mask, 0.5

    async def warm(self):
        return "fake"

    async def segment(self, frame, marks):
        mask, score = self.mask(frame, marks)
        return {"png": None if mask is None else spike_lib.mask_png(mask), "score": score}

    async def save(self, request):
        masks = {f: m for f, marks in request["photos"].items() if (m := self.mask(f, marks)[0]) is not None}
        folder = self.out / request["part"]
        folder.mkdir(parents=True, exist_ok=True)
        for old in folder.glob("*"):
            old.unlink()
        for name, data in spike_lib.marks_files(request, masks, self.orientations).items():
            (folder / name).write_bytes(data)
        return sorted(masks)


def page_app(out: pathlib.Path):
    import live_api

    return live_api.make_app(FakeSam(out), PHOTOS, HERE / "mark.html", out)


def test_parts_are_well_formed():
    count = len(list(PHOTOS.glob("*.jpg")))
    ids = list(spike_lib.PARTS)
    assert len(ids) < 256 and all(re.fullmatch(r"[a-z]+(-[a-z]+)*", i) for i in ids), ids
    for part, info in spike_lib.PARTS.items():
        assert info["name"].strip(), f"{part} has no name"
        parent = info["parent"]
        assert parent is None or spike_lib.PARTS.get(parent, {}).get("parent", 1) is None, f"{part}: bad parent {parent}"
        photos = info["photos"]
        assert len(photos) >= 3 and len(set(photos)) == len(photos), f"{part}: photos {photos}"
        assert all(0 <= f < count for f in photos), f"{part}: photo outside 0..{count - 1}"
    assert spike_lib.PARTS["engine"]["photos"] == spike_lib.KEYFRAMES, "the engine's saved marks use the keyframes"
    return f"{len(ids)} parts on {len(spike_lib.photos_to_mark())} photos"


def test_page_api_with_fake_sam():
    from fastapi.testclient import TestClient

    with tempfile.TemporaryDirectory() as tmp:
        client = TestClient(page_app(pathlib.Path(tmp)))
        assert "<canvas" in client.get("/").text
        config = client.get("/api/config").json()
        assert list(config["parts"]) == list(spike_lib.PARTS) and config["saved"] == {}, config["saved"]
        key = spike_lib.KEYFRAMES[2]
        outside = min(set(range(len(list(PHOTOS.glob("*.jpg"))))) - set(spike_lib.photos_to_mark()))
        photo = Image.open(io.BytesIO(client.get(f"/photo/{key}.jpg").content))
        assert max(photo.size) == spike_lib.WORKING_SIDE and photo.height > photo.width, photo.size
        assert client.get(f"/photo/{outside}.jpg").status_code == 404, "a photo no part uses was served"
        assert client.post("/api/warm").json() == {"device": "fake"}

        click = {"x": 0.3, "y": 0.2, "positive": True}
        answer = client.post("/api/segment", json={"frame": key, "clicks": [click]}).json()
        shown = Image.open(io.BytesIO(__import__("base64").b64decode(answer["mask"].split(",")[1])))
        assert shown.size == photo.size and shown.mode == "LA", (shown.size, shown.mode)
        assert shown.getpixel((int(0.3 * photo.width), int(0.2 * photo.height)))[1] == 255, "mask not under the click"
        only_no = {"frame": key, "clicks": [{**click, "positive": False}]}
        assert client.post("/api/segment", json=only_no).json()["mask"] is None
        for bad in ({"frame": key, "clicks": [{**click, "x": 1.2}]},
                    {"frame": key, "box": [0.5, 0.1, 0.4, 0.9]},
                    {"frame": key, "box": [0.1, 0.1, 0.4]}):
            assert client.post("/api/segment", json=bad).status_code == 422, f"accepted {bad}"
        assert client.post("/api/segment", json={"frame": outside, "clicks": [click]}).status_code == 404

        request = {"part": "engine", "photos": {str(key): {"clicks": [click], "box": None},
                                                str(spike_lib.KEYFRAMES[0]): {"clicks": [], "box": [0.1, 0.1, 0.9, 0.9]}}}
        assert client.post("/api/save", json=request).json() == {"saved": sorted([key, spike_lib.KEYFRAMES[0]])}
        assert client.post("/api/save", json={**request, "part": "../x"}).status_code == 400
        assert client.post("/api/save", json={**request, "part": "battery"}).status_code == 404, "saved foreign photos"
        assert client.get("/api/config").json()["saved"] == {"engine": sorted([key, spike_lib.KEYFRAMES[0]])}
        saved = pathlib.Path(tmp) / "engine"
        assert json.loads((saved / "marks.json").read_text())["part"] == "engine"
        stored = Image.open(saved / f"{key:05d}.png")
        raw = Image.open(sorted(PHOTOS.glob("*.jpg"))[key])
        raw.thumbnail((spike_lib.WORKING_SIDE, spike_lib.WORKING_SIDE))
        assert stored.size == raw.size, f"saved mask {stored.size}, tracker frame {raw.size}"
        x, y = spike_lib.raw_from_display(0.3, 0.2, raw.getexif().get(274, 1))
        assert stored.getpixel((int(x * stored.width), int(y * stored.height))) == 255, "saved mask not under the click"


def test_view_order_follows_the_cameras():
    """Cameras on a ring, shuffled, must come back in ring order (either direction)."""
    rng = np.random.default_rng(0)
    angles = np.linspace(0, 2 * np.pi, 30, endpoint=False)
    centres = np.stack([np.cos(angles), np.sin(angles), np.zeros_like(angles)], 1)
    directions = -centres + [0, 0, -0.2]
    shuffled = rng.permutation(len(angles))
    order = spike_lib.view_order(centres[shuffled], directions[shuffled])
    assert sorted(order) == list(range(len(angles))), "not a permutation"
    steps = np.diff(shuffled[order]) % len(angles)
    assert set(steps) <= {1, len(angles) - 1} or (steps == steps[0]).sum() >= len(angles) - 2, f"ring broken: {steps}"
    assert spike_lib.iou(np.ones((2, 2), bool), np.ones((2, 2), bool)) == 1.0
    assert spike_lib.iou(np.eye(2, dtype=bool), ~np.eye(2, dtype=bool)) == 0.0


def test_small_tile_sheet():
    photo = np.full((30, 40, 3), 90, np.uint8)
    frames = list(range(10))
    jpg = spike_lib.contact_sheet(lambda f: photo, frames, {}, {}, {"parts": []}, {f: 6 for f in frames},
                                  tile=236, per_row=8, label=lambda f: f"{f} *")
    sheet = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
    assert sheet.shape[:2] == (2 * 236, 8 * 236), sheet.shape


def test_entrypoints_run_in_the_modal_cli_python():
    """`modal run` executes local entrypoints with the modal CLI's own Python, which has no numpy or OpenCV."""
    import os
    import shutil

    # The modal on PATH outside this preflight's own environment is the one `modal run` uses.
    own_bin = str(pathlib.Path(sys.prefix) / "bin")
    path = os.pathsep.join(d for d in os.environ["PATH"].split(os.pathsep) if d.rstrip("/") != own_bin)
    cli = shutil.which("modal", path=path)
    assert cli, "no modal CLI on PATH"
    shebang = pathlib.Path(cli).resolve().read_text(errors="ignore").splitlines()[0]
    python = shebang.removeprefix("#!").strip()
    code = ("import sys; sys.path.insert(0, sys.argv[1]); import sam_track, sam_clicks, spike_lib, json; "
            "plan = sam_track.plan('engine'); assert len(plan['centres']) == 124; sam_track.choose_variant([], 'view order, all keyframes'); "
            "spike_lib.check_prompts({'frames': [], 'parts': []}, [])")
    result = subprocess.run([python, "-c", code, str(HERE)], capture_output=True, text=True, cwd=HERE)
    assert result.returncode == 0, result.stderr.strip().splitlines()[-1]
    return python


def test_cameras_cover_every_photo():
    cameras = json.loads((HERE / "cameras.json").read_text())
    assert sorted(map(int, cameras)) == list(range(len(list(PHOTOS.glob("*.jpg"))))), "camera poses and photos differ"
    return f"{len(cameras)} poses"


def test_projection_matches_opencv():
    """lift.project must agree with OpenCV's model with the same four distortion terms (COLMAP OPENCV, as Brush)."""
    import lift

    rng = np.random.default_rng(1)
    fx, fy, cx, cy, *distortion = params = (2017.87, 2017.68, 1416.0, 1062.0, 0.0636, -0.1051, 0.0001, 0.0001)
    camera = (2832, 2124, params)
    rotation = cv2.Rodrigues(np.array([0.1, -0.2, 0.05]))[0]
    translation = np.array([0.2, -0.1, 3.0])
    in_camera = np.c_[rng.uniform(-0.6, 0.6, (500, 2)), np.ones(500)] * rng.uniform(1, 5, (500, 1))
    points = (in_camera - translation) @ rotation  # world = R^T (camera - t)
    u, v, _ = lift.project(points, rotation, translation, camera, 0.5)
    intrinsics = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]])
    expected = cv2.projectPoints(points, cv2.Rodrigues(rotation)[0], translation, intrinsics, np.array(distortion))[0]
    error = np.abs(np.c_[u, v] - expected[:, 0] * 0.5).max()
    assert error < 1e-6, f"{error:.3g} px off OpenCV"
    away = (np.array([[0, 0, -1.0], [9.0, 0, 1.0]]) - translation) @ rotation  # behind; far outside the frame
    u, v, _ = lift.project(away, rotation, translation, camera, 0.5)
    assert np.isnan(u).all() and np.isnan(v).all(), f"unseeable points projected to {u}, {v}"


def test_compositing_follows_occlusion():
    import lift

    # Three splats share the first cell (depth order: 1, 0, 2); 3 is alone; 4 falls outside the 64x48 photo.
    u, v = np.array([1.0, 1.5, 2.0, 30.0, 500.0]), np.array([1.0, 1.2, 1.1, 30.0, 1.0])
    z, alpha = np.array([2.0, 1.0, 3.0, 1.0, 1.0]), np.array([0.5, 0.5, 0.9, 0.3, 0.9])
    index, px, py, cell, weight = lift.contributions(u, v, z, alpha, 64, 48)
    got = dict(zip(index.tolist(), np.round(weight, 6).tolist()))
    assert got == {1: 0.5, 0: 0.25, 2: 0.225, 3: 0.3}, got
    share = lift.composite(np.isin(index, [1, 3]).astype(float), cell, weight, 64, 48)
    assert share.shape == (12, 16), share.shape
    assert abs(share[0, 0] - 0.5 / 0.975) < 1e-9 and share[7, 7] == 1.0, (share[0, 0], share[7, 7])
    assert np.isnan(share).sum() == share.size - 2, "cells nothing lands in must be unknown"
    colour = lift.composite(np.ones((len(index), 3)), cell, weight, 64, 48)
    assert colour.shape == (12, 16, 3) and colour[0, 0].tolist() == [1.0, 1.0, 1.0], colour.shape


def arc_scene(balls: dict[str, tuple[tuple[float, float, float], float]]):
    """Balls (the parts, id -> centre, radius) in front of a wall, seen by seven cameras on an arc.

    Returns the scene, each ball's exact silhouette in every photo, each ball's splat indices and the wall's.
    """
    import lift

    golden = np.pi * (3 - np.sqrt(5))
    k = np.arange(3000)
    height = 1 - 2 * (k + 0.5) / len(k)
    ring = np.sqrt(1 - height**2)
    sphere = np.c_[ring * np.cos(golden * k), height, ring * np.sin(golden * k)]
    grid = np.arange(-2.5, 2.501, 0.05)
    wall = np.c_[np.repeat(grid, len(grid)), np.tile(grid, len(grid)), np.full(len(grid) ** 2, 1.5)]
    points = np.concatenate([r * sphere + c for c, r in balls.values()] + [wall])
    members = {name: np.arange(i * len(k), (i + 1) * len(k)) for i, name in enumerate(balls)}
    camera = (160, 120, (200.0, 200.0, 80.0, 60.0, 0.0, 0.0, 0.0, 0.0))
    poses, silhouettes = [], {name: {} for name in balls}
    for frame, angle in enumerate(np.radians(np.linspace(-30, 30, 7))):
        centre = 4 * np.array([np.sin(angle), 0, -np.cos(angle)])
        forward = -centre / 4
        rotation = np.stack([np.cross([0, 1, 0], forward), [0, 1, 0], forward])
        poses.append((rotation, -rotation @ centre, camera))
        u, v = np.meshgrid(np.arange(160) + 0.5, np.arange(120) + 0.5)
        rays = np.stack([(u - 80) / 200, (v - 60) / 200, np.ones_like(u)], -1) @ rotation
        rays /= np.linalg.norm(rays, axis=-1, keepdims=True)
        for name, (ball, radius) in balls.items():
            to_ball = np.asarray(ball) - centre
            along = rays @ to_ball
            silhouettes[name][frame] = np.linalg.norm(to_ball - along[..., None] * rays, axis=-1) < radius
    scene = lift.Scene(points, np.full(len(points), 0.9), np.ones((len(points), 3)), poses)
    return scene, silhouettes, members, np.arange(len(k) * len(balls), len(points))


def synthetic_scene():
    """A ball (the part) in front of a wall, seen by seven cameras on an arc; masks are exact ball silhouettes."""
    scene, silhouettes, members, wall = arc_scene({"ball": ((0.0, 0.0, 0.0), 0.5)})
    views = {frame: (mask, 1.0) for frame, mask in silhouettes["ball"].items()}
    truth = np.r_[np.ones(len(members["ball"]), bool), np.zeros(len(wall), bool)]
    return scene, views, truth, len(members["ball"])


def as_views(masks: dict[int, np.ndarray]) -> dict[int, tuple[np.ndarray, float]]:
    return {frame: (mask, 1.0) for frame, mask in masks.items()}


def lift_shares(scene, parts, masks: dict[str, dict[int, np.ndarray]]) -> np.ndarray:
    import lift_all

    return lift_all.lift_parts(scene, parts, {part: {"views": as_views(m)} for part, m in masks.items()})


def facing(scene, indices, centre, keep=lambda d: True) -> np.ndarray:
    """The splats of a ball that the arc sees (the rim and far side are only grazed), filtered by distance."""
    points = scene.points[indices]
    offset = points - np.asarray(centre)
    return indices[(offset[:, 2] < -0.15) & keep(np.linalg.norm(offset, axis=1))]


def test_siblings_are_kept_apart():
    """Two reservoirs side by side each take their own splats; a mask bleeding onto the neighbour loses to its owner."""
    import lift_all

    parts = {"a": {"label": 1, "parent": None}, "b": {"label": 2, "parent": None}}
    balls = {"a": ((-0.3, 0.0, 0.0), 0.25), "b": ((0.3, 0.0, 0.0), 0.25)}
    scene, sil, members, wall = arc_scene(balls)
    labels = lift_shares(scene, parts, sil)
    assert labels.dtype == np.uint8
    found = {}
    for name, number in (("a", 1), ("b", 2)):
        mine = facing(scene, members[name], balls[name][0])
        found[name] = (labels[mine] == number).mean()
        assert found[name] > 0.95, f"{name}: only {found[name]:.1%} of its visible splats labelled {number}"
    assert (labels[wall] != lift_all.NO_PART).mean() < 0.002, "wall labelled as a part"
    # a's mask also covers b in five of seven photos (a share of 5/7 there); b's own share is 1, so b keeps them.
    bleeding = {f: m | sil["b"][f] if f < 5 else m for f, m in sil["a"].items()}
    crossed = lift_shares(scene, parts, {"a": bleeding, "b": sil["b"]})
    kept = (crossed[facing(scene, members["b"], balls["b"][0])] == 2).mean()
    assert kept > 0.95, f"the bleeding sibling took {1 - kept:.1%} of b"
    return f"a {found['a']:.1%}, b {found['b']:.1%}"


def test_child_counts_for_its_parent():
    """A parent covers its child: the child wins where it holds the majority, the parent keeps the rest."""
    import lift_all

    parts = {"engine": {"label": 1, "parent": None}, "cover": {"label": 2, "parent": "engine"}}
    balls = {"engine": ((0.0, 0.0, 0.0), 0.5), "cover": ((0.0, 0.0, -0.55), 0.2)}  # the cover bulges out of the engine
    scene, sil, members, wall = arc_scene(balls)
    cover_centre = balls["cover"][0]
    cap = facing(scene, members["cover"], cover_centre, lambda d: d > 0)
    cap = cap[np.linalg.norm(scene.points[cap], axis=1) > 0.55]  # the part of the cover outside the engine
    body = facing(scene, members["engine"], (0, 0, 0))
    body = body[np.linalg.norm(scene.points[body] - cover_centre, axis=1) > 0.35]  # clear of the cover
    both = lift_shares(scene, parts, sil)
    assert (both[cap] == 2).mean() > 0.95 and (both[body] == 1).mean() > 0.95, (
        f"engine mask covering its cover: cap {(both[cap] == 2).mean():.1%} cover, body {(both[body] == 1).mean():.1%} engine")
    assert (both[wall] != lift_all.NO_PART).mean() < 0.002, "wall labelled as a part"
    # The owner left the cover out of the engine's mask: the engine share is 0 there, the cover still wins its splats.
    hole = {f: m & ~sil["cover"][f] for f, m in sil["engine"].items()}
    holed = lift_shares(scene, parts, {"engine": hole, "cover": sil["cover"]})
    assert (holed[cap] == 2).mean() > 0.95 and (holed[body] == 1).mean() > 0.95, "a hole in the engine mask lost the cover"
    # Only the engine marked: the cover's splats are the engine's.
    alone = lift_shares(scene, parts, {"engine": sil["engine"]})
    assert (alone[cap] == 1).mean() > 0.95 and (alone[body] == 1).mean() > 0.95, "an unmarked child must stay in its parent"
    # Only the cover marked: its splats are labelled, the engine has no say.
    child_only = lift_shares(scene, parts, {"cover": sil["cover"]})
    assert (child_only[cap] == 2).mean() > 0.95 and (child_only[body] != 1).all(), "an unmarked parent got labels"
    # The cover is seen in photos 0-1 and the engine in 3-5 (a hole where the cover is, elsewhere): neither holds a
    # majority alone (2/7 and 3/7), together they do (5/7). The splat belongs to the engine, and the cover, lacking
    # the majority, does not take it.
    split_cover = {f: m if f < 2 else np.zeros_like(m) for f, m in sil["cover"].items()}
    split_engine = {f: m if 3 <= f < 6 else m & ~sil["cover"][f] for f, m in sil["engine"].items()}
    split = lift_shares(scene, parts, {"engine": split_engine, "cover": split_cover})
    # Shares are fuzzy at 2/7 and 3/7, so this checks the bulk: without the union most would be 0 (the engine alone
    # holds more than half on about a quarter of them), and with it the engine takes them and the cover few.
    split_share = np.bincount(split[cap], minlength=3) / len(cap)
    assert split_share[1] > 0.7 and split_share[2] < 0.2, f"a split cap: none, engine, cover = {split_share.round(2)}"
    return f"cap {(both[cap] == 2).mean():.1%} cover, body {(both[body] == 1).mean():.1%} engine"


def test_assign_on_shares():
    """The rule on hand-made shares: competition, majority threshold, child over parent, label dtype."""
    import lift_all

    parts = {"a": {"label": 1, "parent": None}, "b": {"label": 2, "parent": None},
             "p": {"label": 3, "parent": None}, "c1": {"label": 4, "parent": "p"}, "c2": {"label": 5, "parent": "p"}}
    shares = {"a": np.array([0.9, 0.6, 0.5, 0.0, 0.0, 0.0]), "b": np.array([0.3, 0.8, 0.5, 0.0, 0.0, 0.0]),
              "p": np.array([0.0, 0.0, 0.0, 0.9, 0.9, 0.4]), "c1": np.array([0.0, 0.0, 0.0, 0.7, 0.4, 0.0]),
              "c2": np.array([0.0, 0.0, 0.0, 0.6, 0.45, 0.6])}
    groups = {"a": shares["a"], "b": shares["b"], "p": np.maximum(shares["p"], np.maximum(shares["c1"], shares["c2"]))}
    got = lift_all.assign(parts, shares, groups)
    # a wins 0, b wins 1 (larger share), 2 is a tie at exactly 0.5 (no majority), c1 beats c2, p keeps 4, c2 has a
    # majority with the group's share only 0.6 so it wins 5.
    assert got.dtype == np.uint8 and got.tolist() == [1, 2, 0, 4, 3, 5], got.tolist()


def test_pack_and_parts_agree():
    import lift_all

    parts = lift_all.pack_parts()  # asserts the ids and parents match spike_lib.PARTS
    assert [p["label"] for p in parts.values()] == list(range(1, len(parts) + 1)), "labels are not 1-based in pack order"
    assert set(parts) == set(spike_lib.PARTS), "a part is missing on one side"
    assert all(p["parent"] is None or p["parent"] in parts for p in parts.values()), "a parent is not a part"
    return f"{len(parts)} parts, labels 1..{len(parts)}"


def test_parts_ply_tints_each_part():
    import lift
    import lift_all

    dtype = [(f"f_dc_{c}", "<f4") for c in range(3)]
    splat = np.zeros(4, dtype)
    tinted = lift_all.tint(splat, np.array([0, 1, 2, 1], np.uint8))
    colour = np.stack([tinted[f"f_dc_{c}"] for c in range(3)], 1)
    assert (colour[0] == 0).all() and (colour[1] == colour[3]).all() and not np.allclose(colour[1], colour[2])
    rgb = 0.5 + lift.SH_C0 * colour[1]  # the tint moves the colour towards the part's own
    assert (rgb - 0.5) @ (np.array(lift_all.PART_RGB[0]) - 0.5) > 0 and (splat["f_dc_0"] == 0).all()


def test_holdouts_and_variant_choice():
    angles = np.linspace(0, 2 * np.pi, 30, endpoint=False)
    centres = np.stack([np.cos(angles), np.sin(angles), np.zeros_like(angles)], 1)
    directions = -centres + [0, 0, -0.2]
    # Four cameras bunched together and one opposite: the opposite one and the bunch's far end are hardest to predict.
    assert spike_lib.pick_holdouts([0, 1, 2, 3, 15], centres, directions) == [0, 15]
    hidden = spike_lib.pick_holdouts([20, 4, 9, 1], centres, directions)
    assert len(hidden) == 2 and set(hidden) <= {1, 4, 9, 20}, hidden
    assert spike_lib.pick_holdouts([0, 5, 9], centres, directions) == [], "scoring with fewer than 4 keyframes"
    import sam_track

    default = sam_track.DEFAULT_VARIANT
    assert sam_track.choose_variant([1, 2, 3], "") == (False, default)
    assert sam_track.choose_variant([1, 2, 3, 4], "") == (True, "")
    named = "capture order, all keyframes"
    assert sam_track.choose_variant([1, 2, 3, 4, 5], named) == (False, named)
    try:
        sam_track.choose_variant([1, 2, 3, 4], "nope")
    except AssertionError:
        return f"holdouts [0, 15]; unscored runs {default!r}"
    raise AssertionError("an unknown variant was accepted")


def test_lift_recovers_a_synthetic_part():
    scene, views, truth, balls = synthetic_scene()
    votes = scene.votes(views)
    labels = scene.labels(votes)
    wall_wrong = labels[balls:].mean()
    assert wall_wrong < 0.002, f"{wall_wrong:.2%} of the wall labelled as the part"
    facing = scene.points[:balls, 2] < -0.15  # faces the arc; the rim and poles are only ever grazed
    ball_found = labels[:balls][facing].mean()
    assert ball_found > 0.99, f"only {ball_found:.1%} of the visible ball labelled"
    left_out = votes - scene.votes({3: views[3]})
    rebuilt = scene.votes({f: v for f, v in views.items() if f != 3})
    assert np.allclose(left_out, rebuilt), "leaving a photo out is not subtracting its votes"
    # Perfect labels do not score 1: a part in front takes every cell it partly covers.
    lifted = np.array([scene.check(labels, f, mask)[0] for f, (mask, _) in views.items()])
    perfect = np.array([scene.check(truth, f, mask)[0] for f, (mask, _) in views.items()])
    assert (lifted >= perfect - 0.01).all() and perfect.min() > 0.75, f"IoU {lifted.round(3)}, perfect {perfect.round(3)}"
    return f"wall {wall_wrong:.2%} wrong, visible ball {ball_found:.1%} found, IoU {lifted.min():.2f} (perfect {perfect.min():.2f})"


def test_lift_ignores_a_tracker_mistake():
    """Two tracked photos mark the wall instead of the ball: they are outvoted and then stop voting."""
    import lift

    scene, views, truth, balls = synthetic_scene()
    keyframes = {f: views[f][0] for f in (0, 3, 6)}
    tracked = {f: views[f][0] for f in (1, 2, 4, 5)}
    for f in (2, 4):
        tracked[f] = np.roll(tracked[f], 45, axis=1)  # the wall beside the ball
    voting, rejected = lift.voters(scene, keyframes, tracked, 1.0)
    assert rejected == [2, 4], f"rejected {rejected}"
    labels = scene.labels(scene.votes(voting))
    wrong = (labels != truth)[balls:].mean()
    assert wrong < 0.002, f"{wrong:.2%} of the wall labelled after rejecting"
    return f"rejected photos {[f + 1 for f in rejected]}"


def test_colmap_poses_reproject_their_points():
    """The poses lift reads must put each COLMAP 3D point back where it was matched, as closely as COLMAP does."""
    import struct

    import lift

    sparse = lift.SPARSE
    poses = lift.read_cameras(sparse)
    with open(sparse / "points3D.bin", "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        xyz, reported = {}, []
        for _ in range(n):
            point_id, x, y, z = struct.unpack("<Qddd", f.read(32))
            f.seek(3, 1)
            error, track = struct.unpack("<dQ", f.read(16))
            f.seek(8 * track, 1)
            xyz[point_id] = (x, y, z)
            reported.append(error)
    errors = []
    with open(sparse / "images.bin", "rb") as f:
        (n,) = struct.unpack("<Q", f.read(8))
        for _ in range(n):
            f.seek(64, 1)
            name = b""
            while (c := f.read(1)) != b"\0":
                name += c
            (count,) = struct.unpack("<Q", f.read(8))
            observed = np.frombuffer(f.read(24 * count), dtype=[("x", "<f8"), ("y", "<f8"), ("id", "<i8")])
            observed = observed[observed["id"] >= 0][::20]
            rotation, translation, camera = poses[pathlib.Path(name.decode()).name]
            points = np.array([xyz[i] for i in observed["id"]])
            u, v, _ = lift.project(points, rotation, translation, camera, 1.0)
            errors.append(np.hypot(u - observed["x"], v - observed["y"]))
    # A pose or pixel-centre mistake adds error on top of the reconstruction's own residual.
    ours, colmap = np.median(np.concatenate(errors)), np.median(reported)
    assert ours < colmap + 0.1, f"median reprojection error {ours:.2f} px, COLMAP's own {colmap:.2f} px"
    return f"median {ours:.2f} px, COLMAP's own {colmap:.2f} px"


def check_real_data(clicks_path: pathlib.Path):
    names = sorted(p.name for p in PHOTOS.glob("*.jpg"))
    prompts = json.loads(clicks_path.read_text())

    @check("clicks file matches the photos")
    def _():
        errors, warnings = spike_lib.check_prompts(prompts, names)
        assert not errors, "; ".join(errors)
        parts = [p for p in prompts["parts"] if p["clicks"]]
        return f"{len(parts)} parts, {sum(len(p['clicks']) for p in parts)} clicks" + (
            f"; {len(warnings)} warnings (see below)" if warnings else "")

    @check("photo orientations are supported")
    def _():
        found = {Image.open(PHOTOS / n).getexif().get(274, 1) for n in names}
        assert found <= SUPPORTED_ORIENTATIONS, f"unsupported EXIF orientations {found - SUPPORTED_ORIENTATIONS}"
        return f"EXIF {sorted(found)}"

    @check("click sheet rendered")
    def _():
        orientations, stored = {}, {}
        for i, n in enumerate(names):
            orientations[i] = Image.open(PHOTOS / n).getexif().get(274, 1)
        clicked = sorted({c["frame"] for p in prompts["parts"] for c in p["clicks"]})
        for f in clicked:
            # OpenCV applies EXIF by default; SAM gets pixels re-saved without EXIF, so read the stored pixels.
            photo = cv2.imread(str(PHOTOS / names[f]), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
            scale = 1416 / max(photo.shape[:2])
            stored[f] = cv2.resize(photo, None, fx=scale, fy=scale)
        colours = {p["id"]: spike_lib.PALETTE_BGR[i % len(spike_lib.PALETTE_BGR)] for i, p in enumerate(prompts["parts"])}
        sheet = spike_lib.contact_sheet(lambda f: stored[f], clicked, {}, colours, prompts, orientations)
        legend = np.zeros((40 + 28 * len(colours), 520, 3), np.uint8)
        cv2.putText(legend, "white ring = es esto, red ring = esto no", (10, 26), cv2.FONT_HERSHEY_SIMPLEX, .6, (255, 255, 255), 1)
        for i, p in enumerate(prompts["parts"]):
            cv2.circle(legend, (20, 52 + 28 * i), 9, colours[p["id"]], -1)
            cv2.putText(legend, f"{p['name']} ({len(p['clicks'])})", (40, 58 + 28 * i), cv2.FONT_HERSHEY_SIMPLEX, .6, (255, 255, 255), 1)
        OUT.mkdir(exist_ok=True)
        (OUT / "clicks.jpg").write_bytes(sheet)
        cv2.imwrite(str(OUT / "legend.png"), legend)
        return f"{len(clicked)} photos -> {OUT / 'clicks.jpg'}"

    return spike_lib.check_prompts(prompts, names)[1]


def check_volume():
    @check("owner's marks on the Modal volume")
    def _():
        import lift

        with tempfile.TemporaryDirectory() as folder:
            fetched = subprocess.run(["modal", "volume", "get", "sfg-spike-frames", "/marks", folder],
                                     capture_output=True, text=True)
            assert fetched.returncode == 0, fetched.stderr.strip()
            saved = {part.name: {"marks": json.loads((part / "marks.json").read_text()), "masks": lift.load_masks(part)}
                     for part in sorted(pathlib.Path(folder, "marks").iterdir()) if part.is_dir()}
        names = sorted(PHOTOS.glob("*.jpg"))

        def stored_shape(photo: int) -> tuple[int, int]:
            stored = Image.open(names[photo])
            stored.thumbnail((spike_lib.WORKING_SIDE, spike_lib.WORKING_SIDE))
            return stored.height, stored.width

        errors = spike_lib.check_marks(saved, stored_shape)
        assert not errors, "; ".join(errors)
        return ", ".join(f"{part} {len(entry['masks'])}" for part, entry in saved.items())

    @check("photos on the Modal volume")
    def _():
        listing = subprocess.run(["modal", "volume", "ls", "sfg-spike-frames", "/jpg"], capture_output=True, text=True)
        assert listing.returncode == 0, listing.stderr.strip()
        remote = listing.stdout.count(".jpg")
        local = len(list(PHOTOS.glob("*.jpg")))
        assert remote == local, f"{remote} on the volume, {local} on disk"
        return f"{remote}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clicks", type=pathlib.Path, help="also check a click file for sam_clicks.py")
    parser.add_argument("--volume", action="store_true", help="also list the Modal volume (read only)")
    parser.add_argument("--serve-fake", action="store_true", help="serve the marking page with a fake SAM")
    args = parser.parse_args()
    sys.path.insert(0, str(HERE))
    if args.serve_fake:
        import uvicorn

        uvicorn.run(page_app(OUT / "marks"), host="127.0.0.1", port=8765)
        return

    for name, fn in [("code compiles and lints", test_code_compiles),
                     ("Modal app definition imports", test_modal_app_builds),
                     ("click orientation matches the browser", test_orientation_matches_what_the_browser_shows),
                     ("prompt checks reject bad files", test_prompt_checks_catch_bad_files),
                     ("marks checks reject bad marks", test_marks_checks_catch_bad_marks),
                     ("contact sheet survives edge cases", test_contact_sheet_edge_cases),
                     ("mask orientation matches the photo", test_mask_orientation_matches_the_photo),
                     ("page photo matches the tracker frame", test_working_photo_matches_tracker_frames),
                     ("page script parses", test_page_script_parses),
                     ("parts are well formed", test_parts_are_well_formed),
                     ("page API works end to end with a fake SAM", test_page_api_with_fake_sam),
                     ("view order follows the cameras", test_view_order_follows_the_cameras),
                     ("small-tile sheet lays out", test_small_tile_sheet),
                     ("every photo has a camera pose", test_cameras_cover_every_photo),
                     ("lift projection matches OpenCV", test_projection_matches_opencv),
                     ("lift compositing follows occlusion", test_compositing_follows_occlusion),
                     ("lift recovers a synthetic part", test_lift_recovers_a_synthetic_part),
                     ("lift ignores a tracker mistake", test_lift_ignores_a_tracker_mistake),
                     ("pack.yaml and the marking page agree on parts", test_pack_and_parts_agree),
                     ("multi-part rule on hand-made shares", test_assign_on_shares),
                     ("sibling parts stay apart", test_siblings_are_kept_apart),
                     ("a child counts for its parent", test_child_counts_for_its_parent),
                     ("parts.ply tints each part", test_parts_ply_tints_each_part),
                     ("keyframe holdouts and variant choice", test_holdouts_and_variant_choice),
                     ("COLMAP poses reproject their points", test_colmap_poses_reproject_their_points),
                     ("entrypoints run in the modal CLI's Python", test_entrypoints_run_in_the_modal_cli_python)]:
        check(name)(fn)
    import export_checks  # the export's maths, so a pack is not built on a broken transform

    for name, fn in export_checks.SYNTHETIC_CHECKS:
        check(f"export: {name}")(fn)
    warnings = check_real_data(args.clicks) if args.clicks else []
    if args.volume:
        check_volume()

    for ok, line in results:
        print(f"{'PASS' if ok else 'FAIL'}  {line}")
    for w in warnings:
        print(f"warn  {w}")
    sys.exit(0 if all(ok for ok, _ in results) else 1)


if __name__ == "__main__":
    main()
