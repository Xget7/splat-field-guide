"""Capture-bound saved prompts and masks, published as complete durable revisions."""

import asyncio
import io
import json
from pathlib import Path
import shutil
import uuid

from pipeline.pack import mask_tools
CURRENT = 'current.json'
MARKS = 'marks.json'


def folder(part: Path) -> Path:
    pointer = part / CURRENT
    if not pointer.exists():
        return part
    revision = json.loads(pointer.read_text())['revision']
    if not isinstance(revision, str) or len(revision) != 32 or any(c not in '0123456789abcdef' for c in revision):
        raise ValueError('invalid saved mask revision')
    return part / 'sets' / revision


def read(part: Path, capture: str) -> dict | None:
    saved = folder(part)
    if not (saved / MARKS).exists():
        return None
    marks = json.loads((saved / MARKS).read_text())
    if marks.get('capture') != capture:
        raise ValueError(f'{part.name}: saved masks belong to another or unrecorded capture; import them explicitly')
    expected = {int(f) for f, prompt in marks['photos'].items()
                if prompt.get('box') is not None or any(c['positive'] for c in prompt.get('clicks', []))}
    actual = {int(p.stem) for p in saved.glob('[0-9]*.png')}
    if actual != expected:
        raise ValueError(f'{part.name}: saved prompts and masks disagree')
    return marks


class MaskStore:
    def __init__(self, root: Path, capture: dict, photos: Path, commit=lambda: None):
        self.root, self.capture, self.photos, self.commit = root, capture, photos, commit
        self.lock = asyncio.Lock()

    def read(self, part: str):
        return read(self.root / part, self.capture['sha256'])

    async def replace(self, request: dict, sam) -> list[int]:
        import numpy as np
        from PIL import Image

        async with self.lock:
            if request['capture'] != self.capture['sha256']:
                raise ValueError('capture identity mismatch')
            previous = self.read(request['part'])
            if request.get('revision') != (previous or {}).get('revision'):
                raise ValueError('saved masks changed; reopen this part before saving')
            revision = uuid.uuid4().hex
            part = self.root / request['part']
            staged = part / 'sets' / revision
            staged.mkdir(parents=True)
            pointer = part / CURRENT
            old_pointer = pointer.read_bytes() if pointer.exists() else None
            accepted = False
            try:
                identities = {}
                frames = []
                for frame, prompt in request['photos'].items():
                    if prompt.get('box') is None and not any(c['positive'] for c in prompt.get('clicks', [])):
                        continue
                    photo_id = self.capture['photos'][frame]
                    with Image.open(self.photos / photo_id['name']) as photo:
                        orientation = photo.getexif().get(274, 1)
                        size = mask_tools.working_photo(photo).size
                    result = await sam.segment(frame, prompt, self.capture['sha256'])
                    if result['png'] is None:
                        raise RuntimeError(f'SAM returned no mask for photo {frame + 1}')
                    with Image.open(io.BytesIO(result['png'])) as image:
                        if image.size != size:
                            raise RuntimeError(f'SAM mask shape differs from photo {frame + 1}')
                        mask = np.asarray(image.getchannel('A')) > 0
                    if not mask.any():
                        raise RuntimeError(f'SAM returned an empty mask for photo {frame + 1}')
                    raw = mask_tools.raw_from_display_mask(mask, orientation)
                    Image.fromarray(raw.astype(np.uint8) * 255, 'L').save(staged / f'{frame:05d}.png')
                    identities[str(frame)] = photo_id
                    frames.append(frame)
                saved = {**request, 'revision': revision, 'photoIdentities': identities}
                (staged / MARKS).write_text(json.dumps(saved, indent=2) + '\n')
                read(staged, self.capture['sha256'])
                # The complete revision reaches durable storage before its publication pointer does.
                self.commit()
                temporary = pointer.with_suffix('.tmp')
                temporary.write_text(json.dumps({'revision': revision}) + '\n')
                temporary.replace(pointer)
                try:
                    self.commit()
                except BaseException:
                    if old_pointer is None:
                        pointer.unlink()
                    else:
                        temporary.write_bytes(old_pointer)
                        temporary.replace(pointer)
                    self.commit()
                    raise
                accepted = True
                return sorted(frames)
            finally:
                if not accepted:
                    shutil.rmtree(staged, ignore_errors=True)
