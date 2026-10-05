# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy<2", "opencv-python-headless", "pillow", "scipy"]
# ///
"""Explicitly bind legacy saved annotations to a capture, retaining their retrospective provenance."""

import argparse
import json
from pathlib import Path
import shutil

from PIL import Image

import artifacts
import lift
import masks
import mask_tools


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--marks', type=Path, required=True)
    parser.add_argument('--tracks', type=Path, required=True)
    parser.add_argument('--photos', type=Path, default=lift.PHOTOS)
    parser.add_argument('--sparse', type=Path, default=lift.SPARSE)
    parser.add_argument('--confirm-capture', required=True, help='SHA-256 identity of the capture these legacy masks were authored on')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    capture = artifacts.capture(args.photos)
    if args.confirm_capture != capture['sha256']:
        raise ValueError('capture confirmation does not match photo bytes')
    if args.out.exists():
        raise ValueError('choose a new annotation import directory')
    saved = {}
    for part in mask_tools.PARTS:
        source = masks.folder(args.marks / part)
        saved[part] = {'marks': json.loads((source / 'marks.json').read_text()), 'masks': lift.load_masks(source)}

    def shape_of(frame):
        with Image.open(args.photos / capture['photos'][frame]['name']) as photo:
            photo.thumbnail((mask_tools.WORKING_SIDE, mask_tools.WORKING_SIDE))
            return photo.height, photo.width

    errors = mask_tools.check_marks(saved, shape_of)
    if errors:
        raise ValueError('; '.join(errors))
    reconstruction = artifacts.reconstruction(args.sparse)['sha256']
    with artifacts.candidate(args.out) as staged:
        for part, entry in saved.items():
            source = masks.folder(args.marks / part)
            target = staged / 'marks' / part
            shutil.copytree(source, target)
            marks = {**entry['marks'], 'capture': capture['sha256'],
                     'photoIdentities': {f: capture['photos'][int(f)] for f in entry['marks']['photos']},
                     'importedFromSha256': artifacts.tree(source),
                     'binding': 'retrospective; original capture identity was not recorded'}
            (target / 'marks.json').write_text(json.dumps(marks, indent=2) + '\n')
            masks.read(target, capture['sha256'])
            track_source = args.tracks / part
            track_target = staged / 'tracks' / part
            shutil.copytree(track_source, track_target)
            report = json.loads((track_target / 'report.json').read_text())
            if set(map(int, report['photos'])) != set(range(len(capture['photos']))):
                raise ValueError(f'{part}: incomplete legacy tracking')
            for frame in range(len(capture['photos'])):
                if not (track_target / 'masks' / f'{frame:05d}.png').is_file():
                    raise ValueError(f'{part}: missing tracked mask {frame}')
            report.update(part=part, capture_sha256=capture['sha256'], reconstruction_sha256=reconstruction,
                          marks_sha256=artifacts.tree(target), importedFromSha256=artifacts.tree(track_source),
                          binding='retrospective; original SAM checkpoint and inputs were not recorded')
            (track_target / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        (staged / 'import.json').write_text(json.dumps({'capture': capture, 'reconstructionSha256': reconstruction,
                                                     'note': 'Identities record imported bytes, not evidence of historical SAM execution.'}, indent=2) + '\n')
    print(f'Imported capture-bound annotations into {args.out}')


if __name__ == '__main__':
    main()
