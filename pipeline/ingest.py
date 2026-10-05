# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow", "numpy<2", "opencv-python-headless", "scipy", "pyyaml"]
# ///
"""Ingest a Polycam photo export without losing the stored layout or Apple gravity metadata."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess

from PIL import Image

import artifacts
import export

ROOT = Path(__file__).resolve().parents[1]
PHOTO_SUFFIXES = {'.jpg', '.jpeg', '.heic', '.heif'}


def ingest(source: Path, output: Path):
    if output.resolve().is_relative_to(source.resolve()):
        raise ValueError('capture output cannot be inside its source')
    originals = sorted(p for p in source.rglob('*') if p.is_file() and p.suffix.lower() in PHOTO_SUFFIXES)
    if not originals:
        raise ValueError('source contains no photos')
    input_files = {p.relative_to(source).as_posix(): artifacts.sha256(p) for p in sorted(source.rglob('*')) if p.is_file()}
    input_identity = artifacts.identity(input_files)
    if output.exists():
        receipt = json.loads((output / 'capture.json').read_text())
        if receipt['inputSha256'] != input_identity or receipt['capture'] != artifacts.capture(output / 'jpg'):
            raise ValueError('capture inputs changed; choose a new output directory')
        print('Capture already matches its recorded inputs.')
        return
    names = [p.stem + '.jpg' for p in originals]
    if len(names) != len(set(names)):
        raise ValueError('photo names collide after JPEG conversion')
    with artifacts.candidate(output) as staged:
        # Keep depth, camera JSON and original HEIFs beside the exact JPEG training inputs.
        shutil.copytree(source, staged / 'originals')
        photos = staged / 'jpg'
        photos.mkdir()
        methods = {}
        for original, name in zip(originals, names):
            target = photos / name
            if original.suffix.lower() in {'.jpg', '.jpeg'}:
                shutil.copyfile(original, target)
                methods[name] = 'original JPEG bytes'
            else:
                subprocess.run(['sips', '-s', 'format', 'jpeg', str(original), '--out', str(target)], check=True,
                               capture_output=True)
                subprocess.run(['exiftool', '-overwrite_original', '-TagsFromFile', str(original), '-all:all', str(target)],
                               check=True, capture_output=True)
                metadata = json.loads(subprocess.check_output(['exiftool', '-json', '-n', '-ImageWidth', '-ImageHeight',
                                                              str(original)], text=True))[0]
                with Image.open(target) as image:
                    if image.size != (metadata['ImageWidth'], metadata['ImageHeight']):
                        raise ValueError('HEIF conversion rotated the stored pixels; refuse to guess camera layout')
                methods[name] = 'sips JPEG conversion and exiftool all:all metadata copy'
        export.read_orientations(artifacts.photo_paths(photos))
        export.read_device_gravity(artifacts.photo_paths(photos))
        receipt = {'schemaVersion': 1, 'inputSha256': input_identity, 'inputs': input_files,
                   'conversion': methods, 'capture': artifacts.capture(photos)}
        (staged / 'capture.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Ingested {len(names)} photos into {output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Extracted Polycam export directory')
    parser.add_argument('--out', type=Path, default=ROOT / 'data/capture')
    args = parser.parse_args()
    ingest(args.source, args.out)


if __name__ == '__main__':
    main()
