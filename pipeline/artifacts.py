"""Identities and failure-safe directory publication shared by pipeline stages."""

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import uuid


def sha256(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def identity(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def photo_paths(folder: Path) -> list[Path]:
    return sorted((p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == '.jpg'), key=lambda p: p.name)


def capture(folder: Path) -> dict:
    photos = [{'name': p.name, 'bytes': p.stat().st_size, 'sha256': sha256(p)} for p in photo_paths(folder)]
    if not photos:
        raise ValueError(f'no JPEG photos in {folder}')
    return {'sha256': identity(photos), 'photos': photos}


def reconstruction(folder: Path) -> dict:
    files = {name: sha256(folder / name) for name in ('cameras.bin', 'images.bin', 'points3D.bin')}
    return {'sha256': identity(files), 'files': files}


def tree(folder: Path) -> str:
    return identity({p.relative_to(folder).as_posix(): sha256(p) for p in sorted(folder.rglob('*')) if p.is_file()})


@contextmanager
def candidate(destination: Path):
    """Build and validate before promotion; a failed replacement restores the last complete directory."""
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    staged = Path(tempfile.mkdtemp(prefix=f'.{destination.name}-', dir=destination.parent))
    backup = destination.with_name(f'.{destination.name}-previous-{uuid.uuid4().hex}')
    try:
        yield staged
        existed = destination.exists()
        if existed:
            destination.rename(backup)
        try:
            staged.rename(destination)
        except BaseException:
            if existed:
                backup.rename(destination)
            raise
        if existed:
            shutil.rmtree(backup)
    finally:
        shutil.rmtree(staged, ignore_errors=True)
