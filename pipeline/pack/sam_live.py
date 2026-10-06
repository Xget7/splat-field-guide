"""Marking page with SAM 3 in the loop: the owner marks a whole part on a few photos and sees the mask live.

Check first:  uv run --project pipeline python -m pipeline.pack.preflight              (runs the page against a fake SAM, no GPU)
Deploy:       modal deploy --module pipeline.pack.sam_live         (the page stays up; `modal app stop sfg-sam-live` takes it down)
Saved as complete revisions under /marks/<part>/sets/<revision>/, selected by current.json.
"""

import pathlib

import modal

from pipeline import artifacts
from pipeline.pack import mask_tools
HERE = pathlib.Path(__file__).parent
SAM3_COMMIT = "2345a4a"

app = modal.App("sfg-sam-live")
frames_volume = modal.Volume.from_name("sfg-spike-frames", create_if_missing=True)
hf_cache = modal.Volume.from_name("sfg-hf-cache", create_if_missing=True)

sam_image = (
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
    .add_local_python_source("pipeline.pack.mask_tools", "pipeline.artifacts")
)
web_image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("fastapi[standard]", "pillow", "numpy<2")
    .add_local_python_source("pipeline.pack.mask_tools", "pipeline.pack.live_api", "pipeline.artifacts", "pipeline.pack.masks")
    .add_local_file(HERE / "mark.html", "/root/mark.html")
)


@app.cls(
    gpu="L4",
    image=sam_image,
    volumes={"/frames": frames_volume, "/hf": hf_cache},
    secrets=[modal.Secret.from_name("huggingface")],
    scaledown_window=20 * 60,
    timeout=10 * 60,
)
class Sam:
    @modal.enter()
    def load(self):
        import torch
        from PIL import Image
        from sam3 import build_sam3_image_model
        from sam3.model.sam3_image_processor import Sam3Processor

        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        self.model = build_sam3_image_model(enable_inst_interactivity=True)
        hf_cache.commit()
        processor = Sam3Processor(self.model)
        self.capture = artifacts.capture(pathlib.Path("/frames/jpg"))
        names = [p["name"] for p in self.capture["photos"]]
        # Image features are computed once per photo; every click after that only runs the mask decoder.
        self.states, self.orientations = {}, {}
        with torch.autocast("cuda", dtype=torch.bfloat16):
            for frame in mask_tools.photos_to_mark():
                photo = Image.open(f"/frames/jpg/{names[frame]}")
                self.orientations[frame] = photo.getexif().get(274, 1)
                self.states[frame] = processor.set_image(mask_tools.working_photo(photo))
        print(f"{len(self.states)} photos ready on {torch.cuda.get_device_name()}")

    def mask(self, frame: int, marks: dict):
        import numpy as np
        import torch

        state = self.states[frame]
        prompt = mask_tools.sam_prompt(marks, state["original_width"], state["original_height"])
        if prompt is None:
            return None, 0.0
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            masks, scores, _ = self.model.predict_inst(state, **prompt)
        best = int(np.argmax(scores))
        return masks[best] > 0, float(scores[best])

    @modal.method()
    def warm(self) -> str:
        import torch

        return torch.cuda.get_device_name()

    @modal.method()
    def segment(self, frame: int, marks: dict, capture: str) -> dict:
        assert capture == self.capture["sha256"], "SAM loaded a different capture"
        mask, score = self.mask(frame, marks)
        return {"png": None if mask is None else mask_tools.mask_png(mask), "score": score}



# Saved revision comparison and promotion share one writer.
@app.function(image=web_image, volumes={"/frames": frames_volume}, max_containers=1, scaledown_window=20 * 60, timeout=10 * 60)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def web():
    from pipeline.pack import live_api
    class ModalSam:
        def __init__(self):
            self.sam = Sam()

        async def warm(self):
            return await self.sam.warm.remote.aio()

        async def segment(self, frame, marks, capture):
            return await self.sam.segment.remote.aio(frame, marks, capture)

    return live_api.make_app(ModalSam(), pathlib.Path("/frames/jpg"), pathlib.Path("/root/mark.html"),
                             pathlib.Path("/frames/marks"), frames_volume.reload, frames_volume.commit)
