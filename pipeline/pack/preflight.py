"""GPU-free checks exercise geometry and marking with fake SAM; capture-backed checks require author artifacts."""

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

from pipeline.pack import mask_tools
HERE = pathlib.Path(__file__).parent
DATA = HERE.parents[1] / "data"
PHOTOS = DATA / "capture" / "jpg"
OUT = DATA / "preflight"
SUPPORTED_ORIENTATIONS = {1, 3, 6, 8}
results: list[tuple[bool, str]] = []


def check(name: str):
    def wrap(fn):
        try:
            detail = fn()
            results.append((True, f"{name}{f': {detail}' if detail else ''}"))
        except Exception as e:
            results.append((False, f"{name}: {e}"))
        return fn
    return wrap


def test_code_compiles():
    sources = sorted(p.name for p in HERE.glob("*.py"))
    for file in sources:
        py_compile.compile(str(HERE / file), doraise=True)
    lint = subprocess.run(["nice", "-n", "19", "uvx", "ruff", "check", "--quiet", "--select", "F,E9", *sources],
                          cwd=HERE, capture_output=True, text=True)
    assert lint.returncode == 0, lint.stdout.strip() or lint.stderr.strip()


def test_modal_app_builds():
    from pipeline.pack import sam_live
    from pipeline.pack import sam_track
    sam = sam_live.Sam()  # the web function calls these by name, so a rename must fail here, not on Modal
    missing = [m for m in ("warm", "segment") if not hasattr(sam, m)]
    assert not missing, f"sam_live.Sam lacks {missing}"
    assert sam_track.DEFAULT_VARIANT in sam_track.VARIANTS
    assert {order for order, _ in sam_track.VARIANTS.values()} == {"capture", "view"}


def test_orientation_matches_what_the_browser_shows():
    w, h = 40, 30
    for orientation in SUPPORTED_ORIENTATIONS:
        raw = Image.new("L", (w, h))
        raw.putpixel((31, 7), 255)
        exif = raw.getexif()
        exif[274] = orientation
        buffer = io.BytesIO()
        raw.save(buffer, "PNG", exif=exif)
        shown = np.asarray(ImageOps.exif_transpose(Image.open(buffer)))
        v, u = np.argwhere(shown == 255)[0]
        x, y = mask_tools.raw_from_display((u + 0.5) / shown.shape[1], (v + 0.5) / shown.shape[0], orientation)
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
    assert mask_tools.check_marks(good, lambda f: shape, parts) == []
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
        assert mask_tools.check_marks(marks, lambda f: shape, parts), f"{case} passed"


def test_contact_sheet_edge_cases():
    photo = np.full((30, 40, 3), 90, np.uint8)
    prompts = {"parts": [{"id": "cap", "clicks": [{"frame": 0, "x": .5, "y": .5, "positive": True}]}]}
    colours = {"cap": (0, 140, 255)}
    mask = np.zeros((30, 40), bool)
    mask[10:20, 10:20] = True
    cases = [
        ([], {}, {}),
        ([0, 1], {"cap": {0: mask}}, {0: 6, 1: 1}),     # a frame without a mask, mixed orientations
    ]
    for frames, masks, orientations in cases:
        jpg = mask_tools.contact_sheet(lambda f: photo, frames, masks, colours, prompts, orientations)
        assert cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR) is not None


def test_mask_orientation_matches_the_photo():
    raw = np.zeros((30, 40), bool)
    raw[3:9, 25:37] = True
    for orientation in SUPPORTED_ORIENTATIONS:
        image = Image.fromarray(raw.astype(np.uint8) * 255)
        exif = image.getexif()
        exif[274] = orientation
        buffer = io.BytesIO()
        image.save(buffer, "PNG", exif=exif)
        shown = np.asarray(ImageOps.exif_transpose(Image.open(buffer))) > 0
        back = mask_tools.raw_from_display_mask(shown, orientation)
        assert back.shape == raw.shape and (back == raw).all(), f"orientation {orientation} does not round-trip"


def test_working_photo_matches_tracker_frames():
    name = sorted(PHOTOS.glob("*.jpg"))[mask_tools.KEYFRAMES[0]]
    upright = mask_tools.working_photo(Image.open(name))
    stored = Image.open(name)
    stored.thumbnail((mask_tools.WORKING_SIDE, mask_tools.WORKING_SIDE))
    back = mask_tools.raw_from_display_mask(np.zeros((upright.height, upright.width), bool), stored.getexif().get(274, 1))
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

    def __init__(self, out: pathlib.Path):
        self.out = out
        names = sorted(p.name for p in PHOTOS.glob("*.jpg"))
        self.sizes, self.orientations = {}, {}
        for frame in mask_tools.photos_to_mark():
            photo = Image.open(PHOTOS / names[frame])
            self.orientations[frame] = photo.getexif().get(274, 1)
            self.sizes[frame] = mask_tools.working_photo(photo).size

    def mask(self, frame, marks):
        w, h = self.sizes[frame]
        prompt = mask_tools.sam_prompt(marks, w, h)
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

    async def segment(self, frame, marks, capture):
        mask, score = self.mask(frame, marks)
        return {"png": None if mask is None else mask_tools.mask_png(mask), "score": score}



def page_app(out: pathlib.Path):
    from pipeline.pack import live_api
    return live_api.make_app(FakeSam(out), PHOTOS, HERE / "mark.html", out)


def test_parts_are_well_formed():
    count = len(list(PHOTOS.glob("*.jpg")))
    ids = list(mask_tools.PARTS)
    assert len(ids) < 256 and all(re.fullmatch(r"[a-z]+(-[a-z]+)*", i) for i in ids), ids
    for part, info in mask_tools.PARTS.items():
        assert info["name"].strip(), f"{part} has no name"
        parent = info["parent"]
        assert parent is None or mask_tools.PARTS.get(parent, {}).get("parent", 1) is None, f"{part}: bad parent {parent}"
        photos = info["photos"]
        assert len(photos) >= 3 and len(set(photos)) == len(photos), f"{part}: photos {photos}"
        assert all(0 <= f < count for f in photos), f"{part}: photo outside 0..{count - 1}"
    assert mask_tools.PARTS["engine"]["photos"] == mask_tools.KEYFRAMES, "the engine's saved marks use the keyframes"
    return f"{len(ids)} parts on {len(mask_tools.photos_to_mark())} photos"


def test_page_api_with_fake_sam():
    from fastapi.testclient import TestClient

    with tempfile.TemporaryDirectory() as tmp:
        client = TestClient(page_app(pathlib.Path(tmp)))
        assert "<canvas" in client.get("/").text
        config = client.get("/api/config").json()
        assert list(config["parts"]) == list(mask_tools.PARTS) and config["saved"] == {}, config["saved"]
        capture = config["capture"]
        key = mask_tools.KEYFRAMES[2]
        outside = min(set(range(len(list(PHOTOS.glob("*.jpg"))))) - set(mask_tools.photos_to_mark()))
        photo = Image.open(io.BytesIO(client.get(f"/photo/{key}.jpg").content))
        assert max(photo.size) == mask_tools.WORKING_SIDE and photo.height > photo.width, photo.size
        assert client.get(f"/photo/{outside}.jpg").status_code == 404, "a photo no part uses was served"
        assert client.post("/api/warm").json() == {"device": "fake"}

        click = {"x": 0.3, "y": 0.2, "positive": True}
        answer = client.post("/api/segment", json={"capture": capture, "frame": key, "clicks": [click]}).json()
        shown = Image.open(io.BytesIO(__import__("base64").b64decode(answer["mask"].split(",")[1])))
        assert shown.size == photo.size and shown.mode == "LA", (shown.size, shown.mode)
        assert shown.getpixel((int(0.3 * photo.width), int(0.2 * photo.height)))[1] == 255, "mask not under the click"
        only_no = {"capture": capture, "frame": key, "clicks": [{**click, "positive": False}]}
        assert client.post("/api/segment", json=only_no).json()["mask"] is None
        for bad in ({"capture": capture, "frame": key, "clicks": [{**click, "x": 1.2}]},
                    {"capture": capture, "frame": key, "box": [0.5, 0.1, 0.4, 0.9]},
                    {"capture": capture, "frame": key, "box": [0.1, 0.1, 0.4]}):
            assert client.post("/api/segment", json=bad).status_code == 422, f"accepted {bad}"
        assert client.post("/api/segment", json={"capture": capture, "frame": outside, "clicks": [click]}).status_code == 404

        request = {"capture": capture, "part": "engine", "photos": {str(key): {"clicks": [click], "box": None},
                                                str(mask_tools.KEYFRAMES[0]): {"clicks": [], "box": [0.1, 0.1, 0.9, 0.9]}}}
        assert client.post("/api/save", json=request).json()["saved"] == sorted([key, mask_tools.KEYFRAMES[0]])
        assert client.post("/api/save", json={**request, "part": "../x"}).status_code == 400
        assert client.post("/api/save", json={**request, "part": "battery"}).status_code == 404, "saved foreign photos"
        assert client.get("/api/config").json()["saved"] == {"engine": sorted([key, mask_tools.KEYFRAMES[0]])}
        from pipeline.pack import masks
        saved = masks.folder(pathlib.Path(tmp) / "engine")
        assert json.loads((saved / "marks.json").read_text())["part"] == "engine"
        stored = Image.open(saved / f"{key:05d}.png")
        raw = Image.open(sorted(PHOTOS.glob("*.jpg"))[key])
        raw.thumbnail((mask_tools.WORKING_SIDE, mask_tools.WORKING_SIDE))
        assert stored.size == raw.size, f"saved mask {stored.size}, tracker frame {raw.size}"
        x, y = mask_tools.raw_from_display(0.3, 0.2, raw.getexif().get(274, 1))
        assert stored.getpixel((int(x * stored.width), int(y * stored.height))) == 255, "saved mask not under the click"


def test_view_order_follows_the_cameras():
    rng = np.random.default_rng(0)
    angles = np.linspace(0, 2 * np.pi, 30, endpoint=False)
    centres = np.stack([np.cos(angles), np.sin(angles), np.zeros_like(angles)], 1)
    directions = -centres + [0, 0, -0.2]
    shuffled = rng.permutation(len(angles))
    order = mask_tools.view_order(centres[shuffled], directions[shuffled])
    assert sorted(order) == list(range(len(angles))), "not a permutation"
    steps = np.diff(shuffled[order]) % len(angles)
    assert set(steps) <= {1, len(angles) - 1} or (steps == steps[0]).sum() >= len(angles) - 2, f"ring broken: {steps}"
    assert mask_tools.iou(np.ones((2, 2), bool), np.ones((2, 2), bool)) == 1.0
    assert mask_tools.iou(np.eye(2, dtype=bool), ~np.eye(2, dtype=bool)) == 0.0


def test_small_tile_sheet():
    photo = np.full((30, 40, 3), 90, np.uint8)
    frames = list(range(10))
    jpg = mask_tools.contact_sheet(lambda f: photo, frames, {}, {}, {"parts": []}, {f: 6 for f in frames},
                                  tile=236, per_row=8, label=lambda f: f"{f} *")
    sheet = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
    assert sheet.shape[:2] == (2 * 236, 8 * 236), sheet.shape


def test_entrypoints_run_in_the_modal_cli_python():
    """Modal entrypoints must import under the CLI interpreter without assuming NumPy or OpenCV is installed."""
    import os
    import shutil

    # Resolve Modal outside the preflight environment to exercise the CLI's interpreter.
    own_bin = str(pathlib.Path(sys.prefix) / "bin")
    path = os.pathsep.join(d for d in os.environ["PATH"].split(os.pathsep) if d.rstrip("/") != own_bin)
    cli = shutil.which("modal", path=path)
    assert cli, "no modal CLI on PATH"
    shebang = pathlib.Path(cli).resolve().read_text(errors="ignore").splitlines()[0]
    python = shebang.removeprefix("#!").strip()
    code = ("import sys; sys.path.insert(0, sys.argv[1]); from pipeline.pack import sam_track; import json; "
            "plan = sam_track.plan('engine'); assert len(plan['centres']) == 124; sam_track.choose_variant([], 'view order, all keyframes'); "
            "assert len(plan['photo_identities']) == 124")
    result = subprocess.run([python, "-c", code, str(HERE.parents[1])], capture_output=True, text=True, cwd=HERE)
    assert result.returncode == 0, result.stderr.strip().splitlines()[-1]
    return python


def test_cameras_cover_every_photo():
    from pipeline.pack import cameras
    from pipeline.pack import lift
    value = cameras.read(HERE / "cameras.json", PHOTOS, lift.SPARSE)
    assert value == cameras.generate(PHOTOS, lift.SPARSE), "tracker camera geometry differs from reconstruction"
    return f"{len(value['photos'])} capture-bound poses"


def test_projection_matches_opencv():
    from pipeline.pack import lift
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
    from pipeline.pack import lift
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
    """Exact silhouettes and member indices provide independent truth for balls before a wall seen on a camera arc."""
    from pipeline.pack import lift
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
    scene, silhouettes, members, wall = arc_scene({"ball": ((0.0, 0.0, 0.0), 0.5)})
    views = {frame: (mask, 1.0) for frame, mask in silhouettes["ball"].items()}
    truth = np.r_[np.ones(len(members["ball"]), bool), np.zeros(len(wall), bool)]
    return scene, views, truth, len(members["ball"])


def as_views(masks: dict[int, np.ndarray]) -> dict[int, tuple[np.ndarray, float]]:
    return {frame: (mask, 1.0) for frame, mask in masks.items()}


def lift_shares(scene, parts, masks: dict[str, dict[int, np.ndarray]]) -> np.ndarray:
    from pipeline.pack import lift_all
    return lift_all.lift_parts(scene, parts, {part: {"views": as_views(m)} for part, m in masks.items()})


def facing(scene, indices, centre, keep=lambda d: True) -> np.ndarray:
    """Exclude the rim and far side, which the camera arc only grazes."""
    points = scene.points[indices]
    offset = points - np.asarray(centre)
    return indices[(offset[:, 2] < -0.15) & keep(np.linalg.norm(offset, axis=1))]


def test_siblings_are_kept_apart():
    from pipeline.pack import lift_all
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
    # b's full mask share must beat a's overlapping 5/7 share.
    bleeding = {f: m | sil["b"][f] if f < 5 else m for f, m in sil["a"].items()}
    crossed = lift_shares(scene, parts, {"a": bleeding, "b": sil["b"]})
    kept = (crossed[facing(scene, members["b"], balls["b"][0])] == 2).mean()
    assert kept > 0.95, f"the bleeding sibling took {1 - kept:.1%} of b"
    return f"a {found['a']:.1%}, b {found['b']:.1%}"


def test_child_counts_for_its_parent():
    from pipeline.pack import lift_all
    parts = {"engine": {"label": 1, "parent": None}, "cover": {"label": 2, "parent": "engine"}}
    balls = {"engine": ((0.0, 0.0, 0.0), 0.5), "cover": ((0.0, 0.0, -0.55), 0.2)}
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
    hole = {f: m & ~sil["cover"][f] for f, m in sil["engine"].items()}
    holed = lift_shares(scene, parts, {"engine": hole, "cover": sil["cover"]})
    assert (holed[cap] == 2).mean() > 0.95 and (holed[body] == 1).mean() > 0.95, "a hole in the engine mask lost the cover"
    alone = lift_shares(scene, parts, {"engine": sil["engine"]})
    assert (alone[cap] == 1).mean() > 0.95 and (alone[body] == 1).mean() > 0.95, "an unmarked child must stay in its parent"
    child_only = lift_shares(scene, parts, {"cover": sil["cover"]})
    assert (child_only[cap] == 2).mean() > 0.95 and (child_only[body] != 1).all(), "an unmarked parent got labels"
    # Disjoint 2/7 child and 3/7 parent shares must combine into a 5/7 parent majority.
    split_cover = {f: m if f < 2 else np.zeros_like(m) for f, m in sil["cover"].items()}
    split_engine = {f: m if 3 <= f < 6 else m & ~sil["cover"][f] for f, m in sil["engine"].items()}
    split = lift_shares(scene, parts, {"engine": split_engine, "cover": split_cover})
    # Neighbourhood pooling blurs the 2/7 and 3/7 shares, so check bulk ownership.
    split_share = np.bincount(split[cap], minlength=3) / len(cap)
    assert split_share[1] > 0.7 and split_share[2] < 0.2, f"a split cap: none, engine, cover = {split_share.round(2)}"
    return f"cap {(both[cap] == 2).mean():.1%} cover, body {(both[body] == 1).mean():.1%} engine"


def test_assign_on_shares():
    from pipeline.pack import lift_all
    parts = {"a": {"label": 1, "parent": None}, "b": {"label": 2, "parent": None},
             "p": {"label": 3, "parent": None}, "c1": {"label": 4, "parent": "p"}, "c2": {"label": 5, "parent": "p"}}
    shares = {"a": np.array([0.9, 0.6, 0.5, 0.0, 0.0, 0.0]), "b": np.array([0.3, 0.8, 0.5, 0.0, 0.0, 0.0]),
              "p": np.array([0.0, 0.0, 0.0, 0.9, 0.9, 0.4]), "c1": np.array([0.0, 0.0, 0.0, 0.7, 0.4, 0.0]),
              "c2": np.array([0.0, 0.0, 0.0, 0.6, 0.45, 0.6])}
    groups = {"a": shares["a"], "b": shares["b"], "p": np.maximum(shares["p"], np.maximum(shares["c1"], shares["c2"]))}
    got = lift_all.assign(parts, shares, groups)
    assert got.dtype == np.uint8 and got.tolist() == [1, 2, 0, 4, 3, 5], got.tolist()


def test_strays_are_dropped():
    from pipeline.pack import lift_all
    rng = np.random.default_rng(1)

    def blob(centre, size, count):
        return np.asarray(centre) + rng.uniform(-size / 2, size / 2, (count, 3))

    parts = {"cap": {"label": 1, "parent": None}, "engine": {"label": 2, "parent": None},
             "cover": {"label": 3, "parent": "engine"}}
    pieces = [(blob([0, 0, 0], 1.0, 4000), 1), (blob([0.75, 0, 0], 0.3, 300), 1), (blob([9, 0, 0], 0.5, 600), 1),
              (blob([20, 0, 0], 2.0, 6000), 2), (blob([20, 1.2, 0], 1.0, 1500), 3), (blob([30, 0, 0], 0.4, 200), 3),
              (blob([19.5, -0.5, 0], 0.2, 100), 3)]
    points = np.concatenate([p for p, _ in pieces])
    labels = np.concatenate([np.full(len(p), label, np.uint8) for p, label in pieces])
    got = lift_all.drop_strays(parts, labels, points)
    starts = np.cumsum([0] + [len(p) for p, _ in pieces])
    kept = [np.unique(got[a:b]).tolist() for a, b in zip(starts[:-1], starts[1:])]
    assert kept == [[1], [1], [0], [2], [3], [0], [2]], kept
    return f"{int((got != labels).sum())} of {len(labels)} dropped"


def test_pack_and_parts_agree():
    from pipeline.pack import lift_all
    parts = lift_all.pack_parts()
    assert [p["label"] for p in parts.values()] == list(range(1, len(parts) + 1)), "labels are not 1-based in pack order"
    assert set(parts) == set(mask_tools.PARTS), "a part is missing on one side"
    assert all(p["parent"] is None or p["parent"] in parts for p in parts.values()), "a parent is not a part"
    return f"{len(parts)} parts, labels 1..{len(parts)}"


def test_parts_ply_tints_each_part():
    from pipeline.pack import lift
    from pipeline.pack import lift_all
    dtype = [(f"f_dc_{c}", "<f4") for c in range(3)]
    splat = np.zeros(4, dtype)
    tinted = lift_all.tint(splat, np.array([0, 1, 2, 1], np.uint8))
    colour = np.stack([tinted[f"f_dc_{c}"] for c in range(3)], 1)
    assert (colour[0] == 0).all() and (colour[1] == colour[3]).all() and not np.allclose(colour[1], colour[2])
    rgb = 0.5 + lift.SH_C0 * colour[1]
    assert (rgb - 0.5) @ (np.array(lift_all.PART_RGB[0]) - 0.5) > 0 and (splat["f_dc_0"] == 0).all()


def test_holdouts_and_variant_choice():
    angles = np.linspace(0, 2 * np.pi, 30, endpoint=False)
    centres = np.stack([np.cos(angles), np.sin(angles), np.zeros_like(angles)], 1)
    directions = -centres + [0, 0, -0.2]
    # Four cameras bunched together and one opposite: the opposite one and the bunch's far end are hardest to predict.
    assert mask_tools.pick_holdouts([0, 1, 2, 3, 15], centres, directions) == [0, 15]
    hidden = mask_tools.pick_holdouts([20, 4, 9, 1], centres, directions)
    assert len(hidden) == 2 and set(hidden) <= {1, 4, 9, 20}, hidden
    assert mask_tools.pick_holdouts([0, 5, 9], centres, directions) == [], "scoring with fewer than 4 keyframes"
    from pipeline.pack import sam_track
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
    from pipeline.pack import lift
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
    import struct

    from pipeline.pack import lift
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


def check_volume():
    @check("owner's marks on the Modal volume")
    def _():
        from pipeline import artifacts
        from pipeline.pack import lift
        from pipeline.pack import masks
        capture = artifacts.capture(PHOTOS)["sha256"]
        with tempfile.TemporaryDirectory() as folder:
            fetched = subprocess.run(["modal", "volume", "get", "sfg-spike-frames", "/marks", folder],
                                     capture_output=True, text=True)
            assert fetched.returncode == 0, fetched.stderr.strip()
            saved = {part.name: {"marks": masks.read(part, capture), "masks": lift.load_masks(part)}
                     for part in sorted(pathlib.Path(folder, "marks").iterdir()) if part.is_dir()}
        names = sorted(PHOTOS.glob("*.jpg"))

        def stored_shape(photo: int) -> tuple[int, int]:
            stored = Image.open(names[photo])
            stored.thumbnail((mask_tools.WORKING_SIDE, mask_tools.WORKING_SIDE))
            return stored.height, stored.width

        errors = mask_tools.check_marks(saved, stored_shape)
        assert not errors, "; ".join(errors)
        return ", ".join(f"{part} {len(entry['masks'])}" for part, entry in saved.items())

    @check("photo count on the Modal volume")
    def _():
        listing = subprocess.run(["modal", "volume", "ls", "sfg-spike-frames", "/jpg"], capture_output=True, text=True)
        assert listing.returncode == 0, listing.stderr.strip()
        remote = listing.stdout.count(".jpg")
        local = len(list(PHOTOS.glob("*.jpg")))
        assert remote == local, f"{remote} on the volume, {local} on disk"
        return f"{remote}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--volume", action="store_true", help="also list the Modal volume (read only)")
    parser.add_argument("--serve-fake", action="store_true", help="serve the marking page with a fake SAM")
    args = parser.parse_args()
    if args.serve_fake:
        import uvicorn

        uvicorn.run(page_app(OUT / "marks"), host="127.0.0.1", port=8765)
        return

    for name, fn in [("code compiles and lints", test_code_compiles),
                     ("Modal app definition imports", test_modal_app_builds),
                     ("click orientation matches the browser", test_orientation_matches_what_the_browser_shows),
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
                     ("stray pieces are dropped", test_strays_are_dropped),
                     ("sibling parts stay apart", test_siblings_are_kept_apart),
                     ("a child counts for its parent", test_child_counts_for_its_parent),
                     ("parts.ply tints each part", test_parts_ply_tints_each_part),
                     ("keyframe holdouts and variant choice", test_holdouts_and_variant_choice),
                     ("COLMAP poses reproject their points", test_colmap_poses_reproject_their_points),
                     ("entrypoints run in the modal CLI's Python", test_entrypoints_run_in_the_modal_cli_python)]:
        check(name)(fn)
    from pipeline.pack import export_checks

    for name, fn in export_checks.SYNTHETIC_CHECKS:
        check(f"export: {name}")(fn)
    if args.volume:
        check_volume()

    for ok, line in results:
        print(f"{'PASS' if ok else 'FAIL'}  {line}")
    sys.exit(0 if all(ok for ok, _ in results) else 1)


if __name__ == "__main__":
    main()
