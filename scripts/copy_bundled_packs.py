"""Copy explicitly bundled pack versions and their manifest-referenced runtime files."""

import argparse
import json
from pathlib import Path, PurePosixPath
import subprocess

MANIFEST_NAME = 'manifest.json'


def relative_path(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or '..' in path.parts or '\\' in value or '\n' in value:
        raise ValueError(f'invalid bundled pack path: {value!r}')
    return path


def copy_packs(source: Path, destination: Path, packs: list[str]):
    included = set()
    for name in packs:
        base = relative_path(name)
        directory = source / base
        manifest = json.loads((directory / MANIFEST_NAME).read_text())
        if str(base) != f"{manifest['packId']}/{manifest['packVersion']}":
            raise ValueError(f'pack identity differs from its directory: {name}')
        files = [MANIFEST_NAME]
        for tier in manifest['tiers']:
            files.extend(tier[kind]['path'] for kind in ('cloud', 'labels'))
        for name in files:
            file = directory / relative_path(name)
            file.resolve().relative_to(directory.resolve())
            if not file.is_file() or file.is_symlink():
                raise ValueError(f'missing or linked runtime pack file: {file}')
            relative = base / relative_path(name)
            included.add('/' + str(relative))
            included.update('/' + str(parent) + '/' for parent in relative.parents if str(parent) != '.')
    destination.mkdir(parents=True, exist_ok=True)
    # Include parents to reach runtime files, then remove everything outside that list.
    subprocess.run(['rsync', '-a', '--delete', '--delete-excluded', '--prune-empty-dirs',
                    '--include-from=-', '--exclude=*', str(source) + '/', str(destination) + '/'],
                   input='\n'.join(sorted(included)) + '\n', text=True, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('packs', nargs='+')
    args = parser.parse_args()
    copy_packs(args.source, args.destination, args.packs)


if __name__ == '__main__':
    main()
