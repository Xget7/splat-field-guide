"""Bake an authored USDZ assembly's final pose without merging its named parts."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile

ASSEMBLED_TIME_CODE = 3250.0
ZIP_TIMESTAMP = 315532800
TIME_SAMPLES = re.compile(
    r'(?m)^([ ]+)(\w+(?:\[\])?) ([\w:]+)\.timeSamples = \{\n([\s\S]*?)^\1\}'
)
SAMPLE = re.compile(r'(?m)^ +([\deE+.-]+): (.*?)(?=^ +[\deE+.-]+: |\Z)', re.S)
PRIM = re.compile(r'(?m)^( *)def (\w+) "([^"]+)"')


def sha256(file: Path) -> str:
    return hashlib.sha256(file.read_bytes()).hexdigest()


def sample_values(body: str) -> list[tuple[float, str]]:
    values = [(float(match[1]), match[2].strip().removesuffix(','))
              for match in SAMPLE.finditer(body)]
    if not values or any(not math.isfinite(time) for time, _ in values):
        raise ValueError('invalid or empty authored animation samples')
    return sorted(values)


def stabilization_time(values: list[tuple[float, str]]) -> float:
    final_value = values[-1][1]
    time = values[-1][0]
    for candidate_time, value in reversed(values[:-1]):
        if value != final_value:
            break
        time = candidate_time
    return time


def assembly_order(layer: str) -> list[str]:
    # A named part is the first branching level above the renderable meshes.
    prims = []
    ancestors = []
    for match in PRIM.finditer(layer):
        indent = len(match[1])
        while ancestors and ancestors[-1]['indent'] >= indent:
            ancestors.pop()
        prim = {'name': match[3], 'type': match[2], 'indent': indent,
                'start': match.start(), 'children': [], 'meshes': match[2] == 'Mesh'}
        if ancestors:
            ancestors[-1]['children'].append(prim)
        prims.append(prim)
        ancestors.append(prim)
    for index, prim in enumerate(prims):
        prim['end'] = next((later['start'] for later in prims[index + 1:]
                            if later['indent'] <= prim['indent']), len(layer))
    for prim in reversed(prims):
        prim['meshes'] = prim['meshes'] or any(child['meshes'] for child in prim['children'])
    root = next((prim for prim in prims if prim['meshes']), None)
    if root is None:
        raise ValueError('USDZ contains no renderable meshes')
    while True:
        parts = [child for child in root['children'] if child['meshes']]
        if len(parts) != 1:
            break
        root = parts[0]
    if len(parts) < 2:
        raise ValueError('USDZ needs at least two independently named parts')
    names = [part['name'] for part in parts]
    if len(set(names)) != len(names):
        raise ValueError('USDZ part names must be unique')
    arrivals = []
    for index, part in enumerate(parts):
        block = layer[part['start']:part['end']]
        movement = [stabilization_time(sample_values(match[4]))
                    for match in TIME_SAMPLES.finditer(block)
                    if match[3].startswith('xformOp:')]
        arrivals.append((max(movement) if movement else -1, index, part['name']))
    return [name for _, _, name in sorted(arrivals)]


def bake_layer(layer: str, sample_time: float) -> tuple[str, int]:
    if not math.isfinite(sample_time):
        raise ValueError('sample time must be finite')
    count = 0

    def final_default(match):
        nonlocal count
        values = sample_values(match[4])
        # This preparation promises the settled pose, so partial animation frames fail.
        if values[-1][0] > sample_time:
            raise ValueError(f'{match[3]} has authored samples after {sample_time:g}')
        count += 1
        return f'{match[1]}{match[2]} {match[3]} = {values[-1][1]}'

    baked = TIME_SAMPLES.sub(final_default, layer)
    if '.timeSamples' in baked:
        raise ValueError('unsupported animation sample syntax')
    baked = re.sub(r'^    (endTimeCode|startTimeCode|timeCodesPerSecond) = [^\n]+\n',
                   '', baked, flags=re.M)
    return baked, count


def layer_metadata(layer: str) -> dict:
    result = {}
    for source_key, key in [('author', 'author'), ('copyright', 'license'), ('url', 'sourceURL')]:
        value = re.search(rf'^        string {source_key} = "([^"\n]*)"', layer, re.M)
        result[key] = value[1] if value else None
    metres = re.search(r'^    metersPerUnit = ([\deE+.-]+)', layer, re.M)
    axis = re.search(r'^    upAxis = "(\w+)"', layer, re.M)
    result['metersPerUnit'] = float(metres[1]) if metres else 0.01
    result['upAxis'] = axis[1] if axis else 'Y'
    return result


def prepare(source: Path, output: Path, metadata_output: Path, sample_time: float) -> dict:
    source = source.resolve(strict=True)
    output = output.resolve()
    metadata_output = metadata_output.resolve()
    if output.suffix != '.usdz' or source == output or metadata_output in (source, output):
        raise ValueError('source, prepared USDZ and metadata require distinct paths')
    binaries = {name: shutil.which(name) for name in ('usdcat', 'usdzip')}
    if not all(binaries.values()):
        raise ValueError('preparation requires the usdcat and usdzip tools included with macOS')
    original = subprocess.check_output([binaries['usdcat'], str(source)], text=True)
    order = assembly_order(original)
    baked, count = bake_layer(original, sample_time)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ar-assembly-', dir=output.parent) as temporary:
        staging = Path(temporary)
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            roots = [entry for entry in entries if PurePosixPath(entry.filename).suffix
                     in ('.usd', '.usda', '.usdc')]
            if not roots:
                raise ValueError('USDZ contains no root USD layer')
            root = PurePosixPath(roots[0].filename)
            for entry in entries:
                relative = PurePosixPath(entry.filename)
                if (relative.is_absolute() or '..' in relative.parts or '\\' in entry.filename
                        or stat.S_ISLNK(entry.external_attr >> 16)):
                    raise ValueError('USDZ contains an unsafe resource path')
                if entry.filename == str(root) or entry.is_dir():
                    continue
                resource = staging / relative
                resource.parent.mkdir(parents=True, exist_ok=True)
                resource.write_bytes(archive.read(entry))
                os.utime(resource, (ZIP_TIMESTAMP, ZIP_TIMESTAMP))
        text_layer = staging / root.with_suffix('.usda')
        binary_layer = staging / root.with_suffix('.usdc')
        text_layer.parent.mkdir(parents=True, exist_ok=True)
        text_layer.write_text(baked)
        subprocess.run([binaries['usdcat'], str(text_layer), '-o', str(binary_layer)], check=True)
        # USDZIP records input mtimes, so fix them before pinning the archive's identity.
        os.utime(binary_layer, (ZIP_TIMESTAMP, ZIP_TIMESTAMP))
        prepared = staging / 'prepared.usdz'
        subprocess.run([binaries['usdzip'], str(prepared), '--arkitAsset', str(binary_layer)],
                       cwd=staging, env={**os.environ, 'TZ': 'UTC'}, check=True)
        subprocess.run([binaries['usdcat'], str(prepared), '--loadOnly'], check=True,
                       stdout=subprocess.DEVNULL)
        shutil.copyfile(prepared, output)
    metadata = {
        'sourceSha256': sha256(source), 'preparedSha256': sha256(output),
        'sourceByteLength': source.stat().st_size, 'preparedByteLength': output.stat().st_size,
        'sampleTime': sample_time, 'bakedAttributeCount': count,
        'partCount': len(order), 'assemblyOrder': order, **layer_metadata(original),
    }
    metadata_output.parent.mkdir(parents=True, exist_ok=True)
    metadata_output.write_text(json.dumps(metadata, indent=2) + '\n')
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--metadata-output', required=True, type=Path)
    parser.add_argument('--sample-time', type=float, default=ASSEMBLED_TIME_CODE)
    args = parser.parse_args()
    try:
        result = prepare(args.source, args.output, args.metadata_output, args.sample_time)
    except (ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        parser.exit(1, f'AR assembly preparation failed: {error}\n')
    print(f'Prepared {result["partCount"]} parts at time {args.sample_time:g}: {args.output}')


if __name__ == '__main__':
    main()
