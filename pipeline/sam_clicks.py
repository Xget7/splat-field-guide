"""Throwaway spike, round two: SAM 3.1 seeded with the owner's clicks instead of text.

Check first:  uv run preflight.py --clicks prompts-v1.json
Smoke (1 min): modal run sam_clicks.py --clicks prompts-v1.json --smoke
Full run:      modal run sam_clicks.py --clicks prompts-v1.json
Out:  ./out-clicks/<part>/<frame>.png masks, ./out-clicks/preview_<part>.jpg and ./out-clicks/preview_all.jpg.
"""

import json
import pathlib

import modal

import mask_tools

HERE = pathlib.Path(__file__).parent
DATA = HERE.parent / "data"
PHOTOS = DATA / "capture" / "jpg"
SAM3_COMMIT = "2345a4a"
MAX_SIDE = 1416

app = modal.App("sfg-sam-clicks")
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
    .add_local_python_source("mask_tools")
)


@app.function(
    gpu="H100",
    image=image,
    volumes={"/frames": frames_volume, "/hf": hf_cache},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=45 * 60,
)
def segment_clicks(prompts: dict, frames: list[int]) -> dict[str, bytes]:
    """Track every clicked part through `frames` (indices into prompts["frames"]) and return masks and previews."""
    import inspect
    import os
    import tempfile
    from collections import defaultdict

    import cv2
    import numpy as np
    from PIL import Image
    from sam3.model_builder import build_sam3_multiplex_video_predictor

    names = sorted(os.listdir("/frames/jpg"))
    assert names == prompts["frames"], "the click tool and the volume disagree on the photo order"

    # SAM reads a folder of <position>.jpg; positions are 0..len(frames)-1, clicks use capture indices.
    video_dir = tempfile.mkdtemp()
    position = {frame: i for i, frame in enumerate(frames)}
    orientations = {}
    for frame in frames:
        photo = Image.open(f"/frames/jpg/{names[frame]}")
        orientations[frame] = photo.getexif().get(274, 1)
        photo.thumbnail((MAX_SIDE, MAX_SIDE))
        photo.save(f"{video_dir}/{position[frame]:05d}.jpg", quality=95)  # stored pixels, like COLMAP
    print(f"{len(frames)} photos, EXIF orientations {sorted(set(orientations.values()))}")

    predictor = build_sam3_multiplex_video_predictor(use_fa3=False)
    hf_cache.commit()
    # Upstream bug at this commit: start_session passes keywords the multiplex init_state does not take.
    init_state = predictor.model.init_state
    accepted = set(inspect.signature(init_state).parameters)
    predictor.model.init_state = lambda **kw: init_state(**{k: v for k, v in kw.items() if k in accepted})
    session = predictor.handle_request(dict(type="start_session", resource_path=video_dir))["session_id"]

    # Every part is one tracked object; its clicks on each photo become one point prompt on that photo.
    parts = [p for p in prompts["parts"] if any(c["frame"] in position for c in p["clicks"])]
    for obj_id, part in enumerate(parts, start=1):
        by_frame = defaultdict(list)
        for click in part["clicks"]:
            if click["frame"] in position:
                by_frame[click["frame"]].append(click)
        for frame, clicks in sorted(by_frame.items()):
            points = [mask_tools.raw_from_display(c["x"], c["y"], orientations[frame]) for c in clicks]
            predictor.handle_request(dict(
                type="add_prompt", session_id=session, frame_index=position[frame], obj_id=obj_id,
                points=[list(p) for p in points], point_labels=[1 if c["positive"] else 0 for c in clicks],
            ))
        print(f"{part['id']}: {sum(len(v) for v in by_frame.values())} clicks on {len(by_frame)} photos")

    # With clicks only (no text), SAM has no detector output to find the first prompted photo, so name it.
    first = min(position[c["frame"]] for p in parts for c in p["clicks"] if c["frame"] in position)
    masks = defaultdict(dict)  # part id -> capture frame -> bool mask
    for response in predictor.handle_stream_request(
        dict(type="propagate_in_video", session_id=session, start_frame_index=first)
    ):
        frame, out = frames[response["frame_index"]], response["outputs"]
        for obj_id, mask in zip(np.asarray(out["out_obj_ids"]).tolist(), np.asarray(out["out_binary_masks"])):
            masks[parts[obj_id - 1]["id"]][frame] = mask
    predictor.handle_request(dict(type="close_session", session_id=session))

    files: dict[str, bytes] = {}
    for part in parts:
        found = masks.get(part["id"], {})
        print(f"{part['id']}: found in {len(found)} of {len(frames)} photos")
        for frame, mask in found.items():
            files[f"{part['id']}/{frame:05d}.png"] = cv2.imencode(".png", mask.astype(np.uint8) * 255)[1].tobytes()

    def photo_for(frame):
        return cv2.imread(f"{video_dir}/{position[frame]:05d}.jpg")

    colours = {p["id"]: mask_tools.PALETTE_BGR[i % len(mask_tools.PALETTE_BGR)] for i, p in enumerate(prompts["parts"])}
    clicked = sorted({c["frame"] for p in parts for c in p["clicks"] if c["frame"] in position})
    spaced = [frames[i] for i in np.linspace(0, len(frames) - 1, min(12, len(frames))).astype(int)]
    sheet = (clicked + [f for f in spaced if f not in clicked])[:16]
    files["preview_all.jpg"] = mask_tools.contact_sheet(photo_for, sheet, masks, colours, prompts, orientations)
    for part in parts:
        own = sorted(masks.get(part["id"], {}))
        picks = [own[i] for i in np.linspace(0, len(own) - 1, min(12, len(own))).astype(int)] if own else []
        files[f"preview_{part['id']}.jpg"] = mask_tools.contact_sheet(
            photo_for, picks, {part["id"]: masks.get(part["id"], {})}, colours, prompts, orientations)
    return files


@app.local_entrypoint()
def main(clicks: str, smoke: bool = False):
    prompts = json.loads(pathlib.Path(clicks).expanduser().read_text())
    names = sorted(p.name for p in PHOTOS.glob("*.jpg"))
    errors, warnings = mask_tools.check_prompts(prompts, names)
    for w in warnings:
        print(f"warning: {w}")
    if errors:
        raise SystemExit("not sent to Modal:\n  " + "\n  ".join(errors) + "\nrun preflight.py for the full check")

    if smoke:
        # Three photos around the first click: exercises image, weights, API and outputs in about a minute.
        start = min(c["frame"] for p in prompts["parts"] for c in p["clicks"])
        frames = list(range(start, min(start + 3, len(names))))
        out = DATA / "segment" / "clicks-smoke"
    else:
        frames = list(range(len(names)))
        out = DATA / "segment" / "clicks"
    print(f"{'smoke' if smoke else 'full'} run on {len(frames)} photos")
    for name, data in segment_clicks.remote(prompts, frames).items():
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(f"written to {out}")
