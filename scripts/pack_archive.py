"""Prepare or package the pinned demo pack using the consumer's manifest and byte validation."""

import argparse
import fcntl
import gzip
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
import artifacts

PACK_ID = 'gol-trend-engine-bay'
PACK_VERSION = 1
ARCHIVE_NAME = f'{PACK_ID}-{PACK_VERSION}.tar.gz'
MANIFEST_NAME = 'manifest.json'
RELEASE_MANIFEST = ROOT / 'content' / PACK_ID / MANIFEST_NAME
DESTINATION = ROOT / 'data/pack' / PACK_ID / str(PACK_VERSION)
VALIDATOR = ROOT / 'scripts/validate-pack.cjs'
MAX_MANIFEST_BYTES = 2 * 1024 * 1024


def validate(directory: Path, expected: dict):
    if json.loads((directory / MANIFEST_NAME).read_text()) != expected:
        raise ValueError('pack manifest differs from the release pinned by this checkout')
    result = subprocess.run(['node', str(VALIDATOR), str(directory)], capture_output=True, text=True)
    if result.returncode:
        raise ValueError(result.stderr.strip())


def entries(manifest: dict) -> dict[str, int]:
    expected = {MANIFEST_NAME: MAX_MANIFEST_BYTES}
    for tier in manifest['tiers']:
        for kind in ('cloud', 'labels'):
            name = tier[kind]['path']
            if name in expected:
                raise ValueError('pack file paths repeat')
            expected[name] = tier[kind]['bytes']
    return expected


def unpack(archive: Path, destination: Path, manifest: dict):
    wanted = entries(manifest)
    found = set()
    with tarfile.open(archive, 'r:gz') as bundle:
        for item in bundle:
            if item.isdir():
                if item.name not in {str(Path(name).parent) for name in wanted}:
                    raise ValueError(f'unexpected archive directory {item.name}')
                continue
            if not item.isfile() or item.name not in wanted or item.name in found:
                raise ValueError(f'unexpected archive entry {item.name}')
            limit = wanted[item.name]
            if item.size > limit or (item.name != MANIFEST_NAME and item.size != limit):
                raise ValueError(f'archive byte count differs for {item.name}')
            target = destination / item.name
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(item) as source, target.open('wb') as output:
                shutil.copyfileobj(source, output)
            found.add(item.name)
    if found != set(wanted):
        raise ValueError('archive is missing required pack files')
    validate(destination, manifest)


def ensure(archive: Path | None, url: str):
    manifest = json.loads(RELEASE_MANIFEST.read_text())
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    with (DESTINATION.parent / '.prepare.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            validate(DESTINATION, manifest)
        except (OSError, ValueError):
            pass
        else:
            print('Demo pack already matches every pinned file digest.')
            return
        with artifacts.candidate(DESTINATION) as candidate:
            if archive is not None:
                unpack(archive, candidate, manifest)
            else:
                if 'FILL_IN' in url:
                    raise ValueError('fill PUBLISHED_REPOSITORY in scripts/prepare.sh, set FIELD_GUIDE_PACK_URL, or pass --pack <archive>')
                with tempfile.NamedTemporaryFile(dir=DESTINATION.parent, suffix='.tar.gz') as downloaded:
                    request = urllib.request.Request(url, headers={'User-Agent': 'FieldGuide-prepare/1'})
                    with urllib.request.urlopen(request, timeout=120) as response:
                        # Bound downloads independently of the compressed stream's expansion.
                        limit = sum(entries(manifest).values()) + MAX_MANIFEST_BYTES
                        while chunk := response.read(1024 * 1024):
                            if downloaded.tell() + len(chunk) > limit:
                                raise ValueError('release archive exceeds its size limit')
                            downloaded.write(chunk)
                    downloaded.flush()
                    unpack(Path(downloaded.name), candidate, manifest)
        print(f'Verified demo pack: {DESTINATION}')


def package(directory: Path, archive: Path):
    manifest = json.loads(RELEASE_MANIFEST.read_text())
    validate(directory, manifest)
    archive.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix='.pack-', dir=archive.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, 'wb') as file, gzip.GzipFile(fileobj=file, mode='wb', filename='', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as bundle:
                for name in sorted(entries(manifest)):
                    path = directory / name
                    info = tarfile.TarInfo(name)
                    info.size = path.stat().st_size
                    info.mode = 0o644
                    info.mtime = info.uid = info.gid = 0
                    with path.open('rb') as source:
                        bundle.addfile(info, source)
        checksum = artifacts.sha256(temporary)
        temporary.replace(archive)
        archive.with_name(archive.name + '.sha256').write_text(f'{checksum}  {archive.name}\n')
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Pack archive: {archive}\nSHA-256: {checksum}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    stages = parser.add_subparsers(dest='stage', required=True)
    preparation = stages.add_parser('ensure')
    preparation.add_argument('--pack', type=Path)
    preparation.add_argument('--url', required=True)
    release = stages.add_parser('package')
    release.add_argument('--pack', type=Path, default=DESTINATION)
    release.add_argument('--out', type=Path, default=ROOT / 'data/pack/releases' / ARCHIVE_NAME)
    args = parser.parse_args()
    if args.stage == 'ensure':
        ensure(args.pack, args.url)
    else:
        package(args.pack, args.out)


if __name__ == '__main__':
    main()
