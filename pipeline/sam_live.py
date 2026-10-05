"""Marking page with SAM 3 in the loop: the owner marks a whole part on a few photos and sees the mask live.

Check first:  uv run preflight.py              (runs the page against a fake SAM, no GPU)
Deploy:       modal deploy sam_live.py         (the page stays up; `modal app stop sfg-sam-live` takes it down)
Saved to the sfg-spike-frames volume under /marks/<part>/: marks.json and one stored-layout mask per photo.
"""

import os
import pathlib

import modal

import mask_tools

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
    .add_local_python_source("mask_tools")
)
web_image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("fastapi[standard]", "pillow", "numpy<2")
    .add_local_python_source("mask_tools", "live_api")
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
        names = sorted(os.listdir("/frames/jpg"))
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
    def segment(self, frame: int, marks: dict) -> dict:
        mask, score = self.mask(frame, marks)
        return {"png": None if mask is None else mask_tools.mask_png(mask), "score": score}

    @modal.method()
    def save(self, request: dict) -> list[int]:
        masks = {}
        for frame, marks in request["photos"].items():
            mask, _ = self.mask(frame, marks)
            if mask is not None:
                masks[frame] = mask
        folder = pathlib.Path("/frames/marks") / request["part"]
        folder.mkdir(parents=True, exist_ok=True)
        for old in folder.glob("*"):
            old.unlink()  # a photo whose marks were cleared must not keep its old mask
        for name, data in mask_tools.marks_files(request, masks, self.orientations).items():
            (folder / name).write_bytes(data)
        frames_volume.commit()
        return sorted(masks)


@app.function(image=web_image, volumes={"/frames": frames_volume}, scaledown_window=20 * 60, timeout=10 * 60)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def web():
    import live_api

    class ModalSam:
        def __init__(self):
            self.sam = Sam()

        async def warm(self):
            return await self.sam.warm.remote.aio()

        async def segment(self, frame, marks):
            return await self.sam.segment.remote.aio(frame, marks)

        async def save(self, request):
            return await self.sam.save.remote.aio(request)

    return live_api.make_app(ModalSam(), pathlib.Path("/frames/jpg"), pathlib.Path("/root/mark.html"),
                             pathlib.Path("/frames/marks"), frames_volume.reload)
