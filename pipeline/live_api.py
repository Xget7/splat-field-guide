"""Web API behind the marking page. No GPU code here, so the preflight runs it against a fake SAM."""

import base64
import io
import pathlib
from typing import Callable, Protocol

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field, model_validator

import mask_tools

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


class SaveRequest(BaseModel):
    part: str
    photos: dict[int, PhotoMarks]


class Sam(Protocol):
    async def warm(self) -> str: ...
    async def segment(self, frame: int, marks: dict) -> dict: ...  # {"png": bytes | None, "score": float}
    async def save(self, request: dict) -> list[int]: ...


def make_app(sam: Sam, photo_dir: pathlib.Path, page: pathlib.Path, marks_dir: pathlib.Path,
             refresh: Callable[[], None] = lambda: None) -> FastAPI:
    """`marks_dir` is where saved parts land (one folder each); `refresh` makes other containers' saves visible."""
    from PIL import Image

    api = FastAPI()
    names = sorted(p.name for p in photo_dir.glob("*.jpg"))
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
        saved = {part: sorted(int(p.stem) for p in (marks_dir / part).glob("[0-9]*.png"))
                 for part in mask_tools.PARTS if (marks_dir / part / "marks.json").exists()}
        return {"parts": mask_tools.PARTS, "saved": saved}

    @api.get("/photo/{frame}.jpg")
    def photo(frame: int):
        if keyframe(frame) not in photos:
            jpg = io.BytesIO()
            mask_tools.working_photo(Image.open(photo_dir / names[frame])).save(jpg, "JPEG", quality=90)
            photos[frame] = jpg.getvalue()
        return Response(photos[frame], media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})

    @api.post("/api/warm")
    async def warm():
        return {"device": await sam.warm()}

    @api.post("/api/segment")
    async def segment(request: SegmentRequest):
        marks = request.model_dump(exclude={"frame"})
        result = await sam.segment(keyframe(request.frame), marks)
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
        return {"saved": await sam.save(request.model_dump())}

    return api
