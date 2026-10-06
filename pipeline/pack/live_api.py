"""Web API behind the marking page. No GPU code here, so the preflight runs it against a fake SAM."""

import base64
import io
import pathlib
from typing import Callable, Protocol

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field, model_validator

from pipeline import artifacts
from pipeline.pack import masks
from pipeline.pack import mask_tools
Unit = Field(ge=0, le=1)


class Click(BaseModel):
    x: float = Unit
    y: float = Unit
    positive: bool


class PhotoMarks(BaseModel):
    clicks: list[Click] = []
    box: tuple[float, float, float, float] | None = None  # x0, y0, x1, y1, relative to the upright photo

    @model_validator(mode="after")
    def box_inside_and_ordered(self):
        if self.box is not None:
            x0, y0, x1, y1 = self.box
            if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
                raise ValueError("box must be x0 < x1 and y0 < y1 inside the photo")
        return self


class SegmentRequest(PhotoMarks):
    frame: int
    capture: str


class SaveRequest(BaseModel):
    part: str
    capture: str
    revision: str | None = None
    photos: dict[int, PhotoMarks]


class Sam(Protocol):
    async def warm(self) -> str: ...
    async def segment(self, frame: int, marks: dict, capture: str) -> dict: ...  # {"png": bytes | None, "score": float}


def make_app(sam: Sam, photo_dir: pathlib.Path, page: pathlib.Path, marks_dir: pathlib.Path,
             refresh: Callable[[], None] = lambda: None, commit: Callable[[], None] = lambda: None) -> FastAPI:
    """`marks_dir` is where saved parts land (one folder each); `refresh` makes other containers' saves visible."""
    from PIL import Image

    api = FastAPI()
    capture = artifacts.capture(photo_dir)
    store = masks.MaskStore(marks_dir, capture, photo_dir, commit)
    names = [p["name"] for p in capture["photos"]]
    photos: dict[int, bytes] = {}
    markable = set(mask_tools.photos_to_mark())

    def keyframe(frame: int) -> int:
        if frame not in markable:
            raise HTTPException(404, f"photo {frame + 1} is not one to mark")
        return frame

    @api.get("/", response_class=HTMLResponse)
    def index():
        return page.read_text()

    @api.get("/api/config")
    def config():
        refresh()
        try:
            marks = {part: saved for part in mask_tools.PARTS if (saved := store.read(part)) is not None}
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        saved = {part: sorted(int(f) for f in entry["photoIdentities"]) for part, entry in marks.items()}
        return {"parts": mask_tools.PARTS, "saved": saved, "marks": marks, "capture": capture["sha256"]}

    @api.get("/photo/{frame}.jpg")
    def photo(frame: int):
        if keyframe(frame) not in photos:
            jpg = io.BytesIO()
            mask_tools.working_photo(Image.open(photo_dir / names[frame])).save(jpg, "JPEG", quality=90)
            photos[frame] = jpg.getvalue()
        return Response(photos[frame], media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})

    @api.get("/mask/{part}/{frame}.png")
    def saved_mask(part: str, frame: int):
        if part not in mask_tools.PARTS:
            raise HTTPException(404, "unknown part")
        refresh()
        entry = store.read(part)
        if entry is None or str(frame) not in entry["photoIdentities"]:
            raise HTTPException(404, "no saved mask")
        photo_id = entry["photoIdentities"][str(frame)]
        with Image.open(photo_dir / photo_id["name"]) as photo:
            orientation = photo.getexif().get(274, 1)
        with Image.open(masks.folder(marks_dir / part) / f"{frame:05d}.png") as image:
            import numpy as np
            raw = np.asarray(image) > 0
        # raw_from_display_mask is inverted by swapping the quarter turns.
        upright = mask_tools.raw_from_display_mask(raw, {6: 8, 8: 6}.get(orientation, orientation))
        return Response(mask_tools.mask_png(upright), media_type="image/png")

    @api.post("/api/warm")
    async def warm():
        return {"device": await sam.warm()}

    @api.post("/api/segment")
    async def segment(request: SegmentRequest):
        if request.capture != capture["sha256"]:
            raise HTTPException(409, "capture identity mismatch")
        marks = request.model_dump(exclude={"frame", "capture"})
        result = await sam.segment(keyframe(request.frame), marks, request.capture)
        png = result["png"]
        return {
            "mask": None if png is None else "data:image/png;base64," + base64.b64encode(png).decode(),
            "score": result["score"],
        }

    @api.post("/api/save")
    async def save(request: SaveRequest):
        if request.part not in mask_tools.PARTS:
            raise HTTPException(400, f"unknown part {request.part}")
        stray = sorted(set(request.photos) - set(mask_tools.PARTS[request.part]["photos"]))
        if stray:
            raise HTTPException(404, f"photos {[f + 1 for f in stray]} are not marked for {request.part}")
        refresh()
        try:
            saved = await store.replace(request.model_dump(), sam)
            return {"saved": saved, "revision": store.read(request.part)["revision"]}
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        except Exception as error:
            raise HTTPException(503, "mask replacement failed; the saved set was kept") from error

    return api
