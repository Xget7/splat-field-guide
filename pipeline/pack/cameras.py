"""Generate capture-bound tracker camera geometry from the reconstruction used by Brush."""

import argparse
import json
from pathlib import Path

from pipeline import artifacts
from pipeline.pack import lift
HERE = Path(__file__).resolve().parent


def generate(photos: Path, sparse: Path) -> dict:
    capture = artifacts.capture(photos)
    poses = lift.read_cameras(sparse)
    names = [p['name'] for p in capture['photos']]
    if set(names) != set(poses):
        raise ValueError('reconstruction photo names differ from the capture')
    cameras = []
    for photo in capture['photos']:
        rotation, translation, _ = poses[photo['name']]
        cameras.append({**photo, 'c': (-rotation.T @ translation).tolist(), 'd': rotation[2].tolist()})
    return {'schemaVersion': 1, 'captureSha256': capture['sha256'],
            'reconstruction': artifacts.reconstruction(sparse), 'photos': cameras}


def read(path: Path, photos: Path, sparse: Path) -> dict:
    value = json.loads(path.read_text())
    if value['captureSha256'] != artifacts.capture(photos)['sha256']:
        raise ValueError('tracker camera capture identity mismatch')
    if value['reconstruction'] != artifacts.reconstruction(sparse):
        raise ValueError('tracker camera reconstruction identity mismatch')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--photos', type=Path, default=lift.PHOTOS)
    parser.add_argument('--sparse', type=Path, default=lift.SPARSE)
    parser.add_argument('--out', type=Path, default=HERE / 'cameras.json')
    args = parser.parse_args()
    value = generate(args.photos, args.sparse)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.out.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(args.out)
    print(f'{len(value["photos"])} tracker cameras bound to {value["captureSha256"]}')


if __name__ == '__main__':
    main()
