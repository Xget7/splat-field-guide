"""Run local Brush training with explicit settings and source identities; --plan starts no GPU work."""

import argparse
import json
from pathlib import Path
import subprocess

from pipeline import artifacts
ROOT = Path(__file__).resolve().parents[2]
SETTINGS = {'steps': 30000, 'resolution': 2832, 'seed': 42, 'max_splats': 10000000, 'sh_degree': 3, 'export_every': 2000}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--brush', type=Path, default=ROOT / 'tools/brush/brush-app-aarch64-apple-darwin/brush_app')
    parser.add_argument('--photos', type=Path, default=ROOT / 'data/capture/jpg')
    parser.add_argument('--sparse', type=Path, default=ROOT / 'data/capture/full/sparse/0')
    parser.add_argument('--out', type=Path, default=ROOT / 'data/splat')
    parser.add_argument('--plan', action='store_true')
    args = parser.parse_args()
    capture = artifacts.capture(args.photos)
    reconstruction = artifacts.reconstruction(args.sparse)
    cameras = json.loads((ROOT / 'pipeline/pack/cameras.json').read_text())
    if cameras['captureSha256'] != capture['sha256'] or cameras['reconstruction'] != reconstruction:
        raise ValueError('generate matching tracker cameras before training')
    if args.out.exists() and not args.plan:
        raise ValueError('training output exists; choose a new output directory')
    receipt = {'captureSha256': capture['sha256'], 'reconstruction': reconstruction, 'settings': SETTINGS,
               'brushSha256': artifacts.sha256(args.brush),
               'brushVersion': subprocess.check_output([str(args.brush), '--version'], text=True).strip()}
    command = [str(args.brush), '<posed-dataset>', '--total-steps', str(SETTINGS['steps']),
               '--max-resolution', str(SETTINGS['resolution']), '--seed', str(SETTINGS['seed']),
               '--max-splats', str(SETTINGS['max_splats']), '--sh-degree', str(SETTINGS['sh_degree']),
               '--export-every', str(SETTINGS['export_every']), '--export-path', '<candidate>',
               '--export-name', 'engine_{iter}.ply']
    receipt['command'] = command
    if args.plan:
        print(json.dumps(receipt, indent=2))
        return
    with artifacts.candidate(args.out) as staged:
        dataset = staged / 'dataset'
        (dataset / 'sparse').mkdir(parents=True)
        (dataset / 'images').symlink_to(args.photos.resolve(), target_is_directory=True)
        (dataset / 'sparse/0').symlink_to(args.sparse.resolve(), target_is_directory=True)
        command[1] = str(dataset)
        command[command.index('<candidate>')] = str(staged)
        with (staged / 'training.log').open('w') as log:
            subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT)
        output = staged / f"engine_{SETTINGS['steps']}.ply"
        if not output.is_file():
            raise ValueError('Brush completed without the final PLY')
        receipt['plySha256'] = artifacts.sha256(output)
        (staged / 'training.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'Training complete: {args.out}')


if __name__ == '__main__':
    main()
