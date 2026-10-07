"""Bundle the pinned, prepared V8 capture without accepting a stale derivative."""

import hashlib
import json
import os
import shutil
from pathlib import Path


def main() -> None:
    root = Path(os.environ['SRCROOT']).resolve().parents[2]
    metadata = json.loads((root / 'apps/field-guide/assets/ar/v8-engine.json').read_text())
    source = root / metadata['preparedPath']
    destination = (
        Path(os.environ['TARGET_BUILD_DIR'])
        / os.environ['UNLOCALIZED_RESOURCES_FOLDER_PATH']
        / metadata['modelPath']
    )
    if not source.is_file():
        destination.unlink(missing_ok=True)
        print('note: V8 capture is missing; prepare it with scripts/prepare_ar_assembly.py')
        return
    digest = hashlib.sha256()
    with source.open('rb') as stream:
        for chunk in iter(lambda: stream.read(128 * 1024), b''):
            digest.update(chunk)
    if source.stat().st_size != metadata['preparedByteLength'] or digest.hexdigest() != metadata['preparedSha256']:
        raise ValueError('Prepared V8 capture does not match assets/ar/v8-engine.json')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    print(f'Bundled V8 capture: {metadata["partCount"]} parts, SHA-256 verified')


if __name__ == '__main__':
    main()
