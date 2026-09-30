"""Carry a part's keyframe masks (drawn on the marking page) to every photo with the SAM 3 tracker.

The photos are not a video, so the order they are fed in matters. Each variant below is scored by hiding one
keyframe the owner drew, tracking from the others and comparing the prediction with the owner's mask (IoU).
The best variant then runs with every keyframe.

Check first:  uv run preflight.py
Run:          modal run sam_track.py [--part engine]
Out:          a mask per photo on the volume at /tracks/<part>/, and data/segment/tracks/<part>/ previews plus report.json.
"""

import json
import pathlib

import modal

import spike_lib

HERE = pathlib.Path(__file__).parent
DATA = HERE.parent / "data"
PHOTOS = DATA / "capture" / "jpg"
SAM3_COMMIT = "2345a4a"

# (photo order, keyframes each photo may attend to; -1 means all of them)
VARIANTS = {
    "capture order, 4 nearest keyframes": ("capture", 4),
    "capture order, all keyframes": ("capture", -1),
    "view order, all keyframes": ("view", -1),
}
HOLDOUTS = [44, 87]  # keyframes far from the others in capture order, so the hardest to predict

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
    .add_local_python_source("spike_lib")
)


@app.function(
    gpu="L4",
    image=image,
    volumes={"/frames": frames_volume, "/hf": hf_cache},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=40 * 60,
)
def track(part: str, centres: list[list[float]], directions: list[list[float]]) -> dict[str, bytes]:
    import os
    import tempfile
    import time

    import cv2
    import numpy as np
    import torch
    from PIL import Image
    from sam3.model_builder import build_sam3_video_model

    names = sorted(os.listdir("/frames/jpg"))
    marks_dir = pathlib.Path("/frames/marks") / part
    drawn = {int(p.stem): cv2.imread(str(p), cv2.IMREAD_GRAYSCALE) > 0 for p in sorted(marks_dir.glob("*.png"))}
    assert drawn, f"no marks saved for {part}; save them on the marking page first"
    assert len(centres) == len(names), f"{len(centres)} camera poses for {len(names)} photos"
    orders = {"capture": list(range(len(names))), "view": spike_lib.view_order(centres, directions)}
    assert all(sorted(order) == list(range(len(names))) for order in orders.values()), "an order skips photos"

    # The tracker reads <position>.jpg; stored pixels at the size the marks were drawn at.
    stored, orientations = {}, {}
    for i, name in enumerate(names):
        photo = Image.open(f"/frames/jpg/{name}")
        orientations[i] = photo.getexif().get(274, 1)
        photo.thumbnail((spike_lib.WORKING_SIDE, spike_lib.WORKING_SIDE))
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

    report = {"keyframes": sorted(drawn), "variants": {}}
    held_out_tiles = {}
    for variant, (order_name, max_cond) in VARIANTS.items():
        started = time.time()
        scores = {}
        for hidden in HOLDOUTS:
            predicted = session(order_name, max_cond, [f for f in drawn if f != hidden])[hidden][0]
            scores[hidden] = spike_lib.iou(predicted, drawn[hidden])
            held_out_tiles[(variant, hidden)] = predicted
        report["variants"][variant] = {"iou": scores, "mean": float(np.mean(list(scores.values()))),
                                       "seconds": round(time.time() - started)}
        print(f"{variant}: IoU {scores} in {time.time() - started:.0f} s")

    best = max(report["variants"], key=lambda v: report["variants"][v]["mean"])
    report["best"] = best
    final = session(*VARIANTS[best], sorted(drawn))
    report["photos"] = {frame: {"area": float(mask.mean()), "score": score} for frame, (mask, score) in final.items()}
    print(f"best: {best}; engine found in {sum(m.any() for m, _ in final.values())} of {len(final)} photos")

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
    files["all.jpg"] = spike_lib.contact_sheet(
        lambda f: stored[f], list(range(len(names))), {part: {f: m for f, (m, _) in final.items()}}, colours, none,
        orientations, tile=236, per_row=8,
        label=lambda f: f"{f + 1}{' *' if f in drawn else ''} {final[f][1]:+.0f}",
    )
    # Held-out check: the owner's mask first, then what each variant predicted without it.
    tiles, masks = [], {}
    for hidden in HOLDOUTS:
        for column, variant in enumerate(["owner", *VARIANTS]):
            key = hidden * 10 + column
            tiles.append(key)
            masks[key] = drawn[hidden] if variant == "owner" else held_out_tiles[(variant, hidden)]
    files["held_out.jpg"] = spike_lib.contact_sheet(
        lambda k: stored[k // 10], tiles, {part: masks}, colours, none, {k: orientations[k // 10] for k in tiles},
        per_row=len(VARIANTS) + 1,
        label=lambda k: f"{k // 10 + 1} " + ("owner" if k % 10 == 0 else f"v{k % 10} "
                        f"{report['variants'][list(VARIANTS)[k % 10 - 1]]['iou'][k // 10]:.2f}"),
    )
    return files


def plan(part: str) -> dict:
    """Everything the run needs from this machine. Runs in the modal CLI's Python, so standard library only."""
    names = sorted(p.name for p in PHOTOS.glob("*.jpg"))
    cameras = json.loads((HERE / "cameras.json").read_text())
    assert len(cameras) == len(names), f"{len(cameras)} camera poses for {len(names)} photos"
    return {"part": part,
            "centres": [cameras[str(i)]["c"] for i in range(len(names))],
            "directions": [cameras[str(i)]["d"] for i in range(len(names))]}


@app.local_entrypoint()
def main(part: str = "engine"):
    out = DATA / "segment" / "tracks" / part
    for name, data in track.remote(**plan(part)).items():
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    report = json.loads((out / "report.json").read_text())
    for variant, result in report["variants"].items():
        print(f"{variant}: mean IoU {result['mean']:.3f} {result['iou']}")
    print(f"best: {report['best']}; written to {out}")
