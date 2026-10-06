"""Convert reviewed raw-reference landmarks into a pack-bound candidate for the app."""

import argparse
import json
from pathlib import Path
import subprocess

import numpy as np

from pipeline import artifacts
ROOT = Path(__file__).resolve().parents[2]
CANDIDATE_STATUS = 'candidate_pending_trained_reference_frame_and_physical_check'


def publish(raw_path: Path, registration_path: Path, manifest_path: Path, output: Path):
    raw = json.loads(raw_path.read_text())
    registration = json.loads(registration_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    accepted = subprocess.run(['node', str(ROOT / 'scripts/validate-pack.cjs'), '--json'],
                              input=json.dumps(manifest), capture_output=True, text=True)
    if accepted.returncode:
        raise ValueError(accepted.stderr.strip())
    if registration.get('matrixOrder') != 'rows' or not registration.get('status', '').startswith('candidate_'):
        raise ValueError('expected a candidate row-major registration')
    for entry in registration['inputs'].values():
        if artifacts.sha256(Path(entry['path'])) != entry['sha256']:
            raise ValueError('registration source identity changed')
    pack_report = json.loads(Path(registration['inputs']['packReport']['path']).read_text())
    if pack_report['sources'] != manifest['sources']:
        raise ValueError('registration belongs to another pack publication')
    model = Path(raw['sourceModel'])
    if raw.get('sourceModelSHA256') != artifacts.sha256(model):
        raise ValueError('raw landmark model identity changed or was not recorded')
    poses = Path(registration['inputs']['poses']['path'])
    expected_model = poses.with_name(poses.name.removesuffix('.poses.json') + '.usdz')
    if model.resolve() != expected_model.resolve():
        raise ValueError('raw landmarks belong to another reference model')
    matrix = np.asarray(registration['rawReferenceFromPack'], float)
    if matrix.shape != (4, 4) or not np.isfinite(matrix).all() or not np.allclose(matrix[3], [0, 0, 0, 1]):
        raise ValueError('invalid registration matrix')
    inverse = np.linalg.inv(matrix)
    landmarks = []
    ids = set()
    for landmark in raw['landmarks']:
        if landmark['id'] in ids:
            raise ValueError('duplicate landmark id')
        ids.add(landmark['id'])
        point = np.asarray(landmark['position'], float)
        if point.shape != (3,) or not np.isfinite(point).all():
            raise ValueError('invalid raw landmark position')
        transformed = inverse @ np.r_[point, 1]
        landmarks.append({k: landmark[k] for k in ('id', 'label', 'color')} | {'position': transformed[:3].tolist()})
    result = {'schemaVersion': 1, 'packId': manifest['packId'], 'packVersion': manifest['packVersion'],
              'referenceFromPack': np.eye(4).tolist(), 'status': CANDIDATE_STATUS, 'landmarks': landmarks,
              'authoring': {'source': 'SceneKit ray intersections; owner must review the picked features',
                            'modelSHA256': artifacts.sha256(model), 'rawSHA256': artifacts.sha256(raw_path),
                            'registrationSHA256': artifacts.sha256(registration_path),
                            'manifestSHA256': artifacts.sha256(manifest_path),
                            'viewport': raw['authoringViewport'],
                            'pixels': [landmark['sourcePixel'] for landmark in raw['landmarks']]}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write('\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--registration', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'data/pack/gol-trend-engine-bay/1/manifest.json')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    publish(args.raw, args.registration, args.manifest, args.out)
    print(f'Candidate landmarks written to {args.out}; physical alignment remains unverified.')


if __name__ == '__main__':
    main()
