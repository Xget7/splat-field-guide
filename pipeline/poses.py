# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Recover OPENCV poses from scratch, retaining inputs, COLMAP version, settings and commands."""

import argparse
import json
from pathlib import Path
import subprocess
import struct

import artifacts

ROOT = Path(__file__).resolve().parents[1]
COLMAP = 'colmap'
FAILURE_LOG_LINES = 20
SETTINGS = {'camera_model': 'OPENCV', 'single_camera': 1, 'max_num_features': 16384,
            'max_image_size': 3200, 'use_gpu': 0, 'guided_matching': 0, 'random_seed': 0}


def commands(photos: Path, output: Path) -> list[list[str]]:
    database = str(output / 'db.db')
    return [
        [COLMAP, 'feature_extractor', '--database_path', database, '--image_path', str(photos),
         '--ImageReader.camera_model', SETTINGS['camera_model'], '--ImageReader.single_camera', '1',
         '--SiftExtraction.max_num_features', str(SETTINGS['max_num_features']),
         '--FeatureExtraction.max_image_size', str(SETTINGS['max_image_size']), '--FeatureExtraction.use_gpu', '0'],
        [COLMAP, 'exhaustive_matcher', '--database_path', database,
         '--FeatureMatching.use_gpu', '0', '--FeatureMatching.guided_matching', '0'],
        [COLMAP, 'mapper', '--database_path', database, '--image_path', str(photos),
         '--output_path', str(output / 'sparse'), '--Mapper.random_seed', str(SETTINGS['random_seed'])],
    ]


def recover(photos: Path, output: Path):
    capture = artifacts.capture(photos)
    version = subprocess.check_output([COLMAP, '-h'], text=True).splitlines()[0]
    if not version.startswith("COLMAP 4.2."):
        raise ValueError("the recorded pose recipe requires COLMAP 4.2.x")
    if output.exists():
        receipt = json.loads((output / 'poses.json').read_text())
        if receipt['captureSha256'] != capture['sha256'] or receipt['settings'] != SETTINGS or receipt['colmap'] != version:
            raise ValueError('pose inputs, settings or tool changed; choose a new output directory')
        if receipt['reconstruction'] != artifacts.reconstruction(output / 'sparse/0'):
            raise ValueError('reconstruction digest mismatch')
        print('Poses already match their recorded inputs.')
        return
    with artifacts.candidate(output) as staged:
        (staged / 'sparse').mkdir()
        invocations = commands(photos.resolve(), staged)
        for index, command in enumerate(invocations):
            with (staged / f'{index}-{command[1]}.log').open('w') as log:
                try:
                    subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
                except subprocess.CalledProcessError as error:
                    log.flush()
                    detail = '\n'.join(Path(log.name).read_text().splitlines()[-FAILURE_LOG_LINES:])
                    raise ValueError(f'COLMAP {command[1]} failed:\n{detail}') from error
        models = list((staged / 'sparse').iterdir())
        if not models:
            detail = '\n'.join((staged / '2-mapper.log').read_text().splitlines()[-FAILURE_LOG_LINES:])
            raise ValueError(f'COLMAP produced no reconstruction; review photo overlap and mapper diagnostics:\n{detail}')
        if len(models) != 1 or models[0].name != '0':
            raise ValueError('capture reconstructed into multiple models; review it before continuing')
        with (staged / "sparse/0/images.bin").open("rb") as stream:
            registered = struct.unpack("<Q", stream.read(8))[0]
        if registered != len(capture["photos"]):
            raise ValueError(f"COLMAP placed {registered} of {len(capture['photos'])} photos")
        # The next stage requires every photo; record COLMAP analysis alongside the input identity.
        analysis = subprocess.check_output([COLMAP, 'model_analyzer', '--path', str(staged / 'sparse/0')],
                                           stderr=subprocess.STDOUT, text=True)
        (staged / 'analysis.txt').write_text(analysis)
        receipt = {'schemaVersion': 1, 'captureSha256': capture['sha256'], 'settings': SETTINGS,
                   'colmap': version, 'commands': invocations, 'reconstruction': artifacts.reconstruction(staged / 'sparse/0')}
        (staged / 'poses.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Recovered poses in {output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--photos', type=Path, default=ROOT / 'data/capture/jpg')
    parser.add_argument('--out', type=Path, default=ROOT / 'data/capture/full')
    args = parser.parse_args()
    recover(args.photos, args.out)


if __name__ == '__main__':
    main()
