"""Carry a part's keyframe masks (drawn on the marking page) to every photo with the SAM 3 tracker.

The keyframes are whatever masks the owner saved for the part under /marks/<part>/. The photos are not a video,
so the order they are fed in matters. With four or more keyframes each variant below is scored by hiding one of the
two keyframes farthest from the others (mask_tools.pick_holdouts), tracking from the rest and comparing the
prediction with the owner's mask (IoU); the best variant then runs with every keyframe. With fewer keyframes, or
with --variant, nothing is scored and one variant runs directly (DEFAULT_VARIANT unless named).

Check first:  uv run preflight.py
Run:          modal run sam_track.py --part engine [--variant "view order, all keyframes"]
Out:          a mask per photo on the volume at /tracks/<part>/, and data/segment/tracks/<part>/ previews plus report.json.
"""

import json
import pathlib

import modal

from pipeline import artifacts
from pipeline.pack import masks as saved_masks
from pipeline.pack import mask_tools
HERE = pathlib.Path(__file__).parent
DATA = HERE.parents[1] / "data"
PHOTOS = DATA / "capture" / "jpg"
SAM3_COMMIT = "2345a4a"

# (photo order, keyframes each photo may attend to; -1 means all of them)
VARIANTS = {
    "capture order, 4 nearest keyframes": ("capture", 4),
    "capture order, all keyframes": ("capture", -1),
    "view order, all keyframes": ("view", -1),
}
DEFAULT_VARIANT = "view order, all keyframes"  # won on the engine; used when there are too few keyframes to score


def choose_variant(keyframes: list[int], requested: str = "") -> tuple[bool, str]:
    """Whether to score the variants, and which one runs when they are not scored."""
    assert not requested or requested in VARIANTS, f"unknown variant {requested!r}; choose from {list(VARIANTS)}"
    if requested or len(keyframes) < mask_tools.MIN_KEYFRAMES_TO_SCORE:
        return False, requested or DEFAULT_VARIANT
    return True, ""


app = modal.App("sfg-sam-track")
frames_volume = modal.Volume.from_name("sfg-spike-frames", create_if_missing=True)
hf_cache = modal.Volume.from_name("sfg-hf-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .uv_pip_install("torch==2.8.0", "torchvision==0.23.0")
    .uv_pip_install(
        f"git+https://github.com/facebookresearch/sam3.git@{SAM3_COMMIT}",
        "setuptools<80",
        "einops",
        "hydra-core",
        "pycocotools",
        "scikit-image",
        "psutil",
        "scipy",
        "opencv-python-headless",
        "pillow",
    )
    .env({"HF_HOME": "/hf"})
    .add_local_python_source("pipeline.pack.mask_tools", "pipeline.artifacts", "pipeline.pack.masks")
)


@app.function(
    gpu="L4",
    image=image,
    volumes={"/frames": frames_volume, "/hf": hf_cache},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=40 * 60,
)
def track(part: str, centres: list[list[float]], directions: list[list[float]], capture: str,
          photo_identities: list[dict], reconstruction_sha256: str, variant: str = "") -> dict[str, bytes]:
    import tempfile
    import time

    import cv2
    import numpy as np
    import torch
    from PIL import Image
    from sam3.model_builder import build_sam3_video_model

    found = artifacts.capture(pathlib.Path("/frames/jpg"))
    assert found["sha256"] == capture and found["photos"] == photo_identities, "tracking capture identity mismatch"
    names = [p["name"] for p in found["photos"]]
    saved_masks.read(pathlib.Path("/frames/marks") / part, capture)
    marks_dir = saved_masks.folder(pathlib.Path("/frames/marks") / part)
    drawn = {int(p.stem): cv2.imread(str(p), cv2.IMREAD_GRAYSCALE) > 0 for p in sorted(marks_dir.glob("*.png"))}
    assert drawn, f"no marks saved for {part}; save them on the marking page first"
    assert len(centres) == len(names), f"{len(centres)} camera poses for {len(names)} photos"
    orders = {"capture": list(range(len(names))), "view": mask_tools.view_order(centres, directions)}
    assert all(sorted(order) == list(range(len(names))) for order in orders.values()), "an order skips photos"

    # The tracker reads <position>.jpg; stored pixels at the size the marks were drawn at.
    stored, orientations = {}, {}
    for i, name in enumerate(names):
        photo = Image.open(f"/frames/jpg/{name}")
        orientations[i] = photo.getexif().get(274, 1)
        photo.thumbnail((mask_tools.WORKING_SIDE, mask_tools.WORKING_SIDE))
        stored[i] = np.asarray(photo.convert("RGB"))[:, :, ::-1]
    for frame, mask in drawn.items():
        assert mask.shape == stored[frame].shape[:2], f"mask {frame} is {mask.shape}, photo {stored[frame].shape}"

    model = build_sam3_video_model()
    hf_cache.commit()
    predictor = model.tracker
    predictor.backbone = model.detector.backbone

    states = {}
    for order_name, order in orders.items():
        video_dir = tempfile.mkdtemp()
        for position, frame in enumerate(order):
            cv2.imwrite(f"{video_dir}/{position:05d}.jpg", stored[frame], [cv2.IMWRITE_JPEG_QUALITY, 95])
        states[order_name] = predictor.init_state(video_path=video_dir)

    def session(order_name: str, max_cond: int, keyframes: list[int]) -> dict[int, tuple[np.ndarray, float]]:
        state, order = states[order_name], orders[order_name]
        position = {frame: i for i, frame in enumerate(order)}
        predictor.clear_all_points_in_video(state)
        predictor.max_cond_frames_in_attn = max_cond
        for frame in keyframes:
            predictor.add_new_mask(inference_state=state, frame_idx=position[frame], obj_id=1,
                                   mask=torch.from_numpy(drawn[frame]))
        first = min(position[f] for f in keyframes)
        out = {}
        for reverse in (False, True):  # forward from the first keyframe, then back to the start
            for i, _, _, video_masks, scores in predictor.propagate_in_video(
                state, start_frame_idx=first, max_frame_num_to_track=len(order), reverse=reverse,
                propagate_preflight=not reverse, tqdm_disable=True,
            ):
                out[order[i]] = ((video_masks[0, 0] > 0).cpu().numpy(), float(scores[0]))
        assert len(out) == len(order), f"tracked {len(out)} of {len(order)} photos"
        return out

    keyframes = sorted(drawn)
    scoring, best = choose_variant(keyframes, variant)
    holdouts = mask_tools.pick_holdouts(keyframes, centres, directions) if scoring else []
    checkpoints = {str(p.relative_to("/hf")): artifacts.sha256(p) for p in pathlib.Path("/hf").rglob("sam3.pt")}
    assert checkpoints, "SAM checkpoint identity unavailable"
    report = {"part": part, "capture_sha256": capture, "reconstruction_sha256": reconstruction_sha256,
              "marks_sha256": artifacts.tree(marks_dir), "sam_commit": SAM3_COMMIT,
              "torch": torch.__version__, "checkpoints": checkpoints,
              "keyframes": keyframes, "holdouts": holdouts, "variants": {}}
    held_out_tiles = {}
    for variant_name, (order_name, max_cond) in (VARIANTS if scoring else {}).items():
        started = time.time()
        scores = {}
        for hidden in holdouts:
            predicted = session(order_name, max_cond, [f for f in keyframes if f != hidden])[hidden][0]
            scores[hidden] = mask_tools.iou(predicted, drawn[hidden])
            held_out_tiles[(variant_name, hidden)] = predicted
        report["variants"][variant_name] = {"iou": scores, "mean": float(np.mean(list(scores.values()))),
                                            "seconds": round(time.time() - started)}
        print(f"{variant_name}: IoU {scores} in {time.time() - started:.0f} s")

    if scoring:
        best = max(report["variants"], key=lambda v: report["variants"][v]["mean"])
    report["best"] = best
    print(f"{len(keyframes)} keyframes {keyframes}; " + (f"held out {holdouts}" if scoring else "scoring skipped") +
          f"; running {best}")
    final = session(*VARIANTS[best], keyframes)
    report["photos"] = {frame: {"area": float(mask.mean()), "score": score} for frame, (mask, score) in final.items()}
    print(f"{part} found in {sum(m.any() for m, _ in final.values())} of {len(final)} photos")

    out_dir = pathlib.Path("/frames/tracks") / part
    out_dir.mkdir(parents=True, exist_ok=True)
    files: dict[str, bytes] = {"report.json": json.dumps(report, indent=2).encode()}
    for frame, (mask, _) in final.items():
        png = cv2.imencode(".png", mask.astype(np.uint8) * 255)[1].tobytes()
        (out_dir / f"{frame:05d}.png").write_bytes(png)
        files[f"masks/{frame:05d}.png"] = png
    (out_dir / "report.json").write_bytes(files["report.json"])
    frames_volume.commit()

    colours = {part: (0, 140, 255)}
    none = {"parts": []}
    files["all.jpg"] = mask_tools.contact_sheet(
        lambda f: stored[f], list(range(len(names))), {part: {f: m for f, (m, _) in final.items()}}, colours, none,
        orientations, tile=236, per_row=8,
        label=lambda f: f"{f + 1}{' *' if f in drawn else ''} {final[f][1]:+.0f}",
    )
    if scoring:  # the owner's mask first, then what each variant predicted without it
        tiles, masks = [], {}
        for hidden in holdouts:
            for column, name in enumerate(["owner", *VARIANTS]):
                key = hidden * 10 + column
                tiles.append(key)
                masks[key] = drawn[hidden] if name == "owner" else held_out_tiles[(name, hidden)]
        files["held_out.jpg"] = mask_tools.contact_sheet(
            lambda k: stored[k // 10], tiles, {part: masks}, colours, none, {k: orientations[k // 10] for k in tiles},
            per_row=len(VARIANTS) + 1,
            label=lambda k: f"{k // 10 + 1} " + ("owner" if k % 10 == 0 else f"v{k % 10} "
                            f"{report['variants'][list(VARIANTS)[k % 10 - 1]]['iou'][k // 10]:.2f}"),
        )
    return files


def plan(part: str) -> dict:
    """Check names, bytes and reconstruction before starting a GPU; standard library only."""
    assert part in mask_tools.PARTS, f"unknown part {part}"
    found = artifacts.capture(PHOTOS)
    cameras = json.loads((HERE / "cameras.json").read_text())
    assert cameras["captureSha256"] == found["sha256"], "tracker cameras belong to another capture"
    assert cameras["reconstruction"] == artifacts.reconstruction(DATA / "capture/full/sparse/0"), \
        "tracker cameras belong to another reconstruction"
    photos = cameras["photos"]
    assert [{k: p[k] for k in ("name", "bytes", "sha256")} for p in photos] == found["photos"], \
        "tracker camera photo identities differ"
    return {"part": part, "capture": found["sha256"], "photo_identities": found["photos"],
            "reconstruction_sha256": cameras["reconstruction"]["sha256"],
            "centres": [p["c"] for p in photos], "directions": [p["d"] for p in photos]}


@app.local_entrypoint()
def main(part: str = "all", variant: str = ""):
    choose_variant([], variant)
    parts = list(mask_tools.PARTS) if part == "all" else [part]
    plans = [plan(p) for p in parts]
    for inputs in plans:
        out = DATA / "segment" / "tracks" / inputs["part"]
        with artifacts.candidate(out) as staged:
            for name, data in track.remote(**inputs, variant=variant).items():
                target = staged / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            report = json.loads((staged / "report.json").read_text())
            assert report["capture_sha256"] == inputs["capture"], "returned tracking capture differs"
            assert len(report["photos"]) == len(inputs["photo_identities"]), "incomplete tracking result"
        print(f"{inputs['part']}: best {report['best']}; written to {out}")
