"""Exercise release packaging and preparation with real pack bytes and fake build tools."""

import gzip
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'pipeline'))
import export_checks


class PreparationTests(unittest.TestCase):
    def test_archive_round_trip_cache_and_failed_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / 'repo'
            (repo / 'scripts').mkdir(parents=True)
            for name in ('prepare.sh', 'package-pack.sh', 'pack_archive.py', 'validate-pack.cjs'):
                shutil.copyfile(ROOT / 'scripts' / name, repo / 'scripts' / name)
            (repo / 'pipeline').mkdir()
            shutil.copyfile(ROOT / 'pipeline/artifacts.py', repo / 'pipeline/artifacts.py')
            domain = repo / 'apps/field-guide/src/domain'
            domain.mkdir(parents=True)
            for name in ('pack.ts', 'parsePack.ts', 'tour.ts'):
                shutil.copyfile(ROOT / 'apps/field-guide/src/domain' / name, domain / name)
            modules = repo / 'apps/field-guide/node_modules'
            modules.mkdir()
            (modules / 'typescript').symlink_to(ROOT / 'apps/field-guide/node_modules/typescript')
            content = repo / 'content/gol-trend-engine-bay'
            content.mkdir(parents=True)
            pack = repo / 'data/pack/gol-trend-engine-bay/1'
            (pack / 'high').mkdir(parents=True)
            manifest = export_checks.sample_manifest()
            manifest['packId'] = 'gol-trend-engine-bay'
            count = 1
            # A native-readable SPZ v3 with one zeroed splat, and its no-part label.
            cloud = gzip.compress(struct.pack('<IIIBBBB', 0x5053474E, 3, count, 0, 12, 0, 0) + bytes(20))
            labels = struct.pack('<4sHHII', b'SFGL', 1, 1, count, 0) + b'\0'
            import hashlib
            for kind, data, name in [('cloud', cloud, 'cloud.spz'), ('labels', labels, 'labels.bin')]:
                (pack / 'high' / name).write_bytes(data)
                manifest['tiers'][0][kind] = {'path': 'high/' + name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
            (pack / 'manifest.json').write_text(json.dumps(manifest))
            (content / 'manifest.json').write_text(json.dumps(manifest))
            archive = repo / 'release.tar.gz'
            package = ['sh', str(repo / 'scripts/package-pack.sh'), '--out', str(archive)]
            result = subprocess.run(package, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            first = archive.read_bytes()
            self.assertEqual(subprocess.run(package, capture_output=True).returncode, 0)
            self.assertEqual(archive.read_bytes(), first)
            self.assertTrue(archive.with_name(archive.name + '.sha256').is_file())

            trace = repo / 'calls'
            environment = {**os.environ, 'FIELD_GUIDE_TEST_TRACE': str(trace)}
            binaries = repo / 'bin'
            binaries.mkdir()
            for command in ('npm', 'pod'):
                script = binaries / command
                script.write_text(f'#!/bin/sh\nprintf "{command} %s\\n" "$*" >> "$FIELD_GUIDE_TEST_TRACE"\n')
                script.chmod(0o755)
            environment['PATH'] = str(binaries) + os.pathsep + environment['PATH']
            engine = repo / 'packages/react-native-splat/scripts/build-ios-engine.sh'
            engine.parent.mkdir(parents=True)
            engine.write_text('#!/bin/sh\nprintf "engine %s\\n" "$#" >> "$FIELD_GUIDE_TEST_TRACE"\n')
            fetch = repo / 'apps/field-guide/scripts/fetch-kokoro-models.py'
            fetch.parent.mkdir()
            fetch.write_text("import os\nwith open(os.environ['FIELD_GUIDE_TEST_TRACE'], 'a') as stream: stream.write('kokoro\\n')\n")
            (repo / 'apps/field-guide/ios').mkdir()
            shutil.rmtree(pack)
            prepare = ['sh', str(repo / 'scripts/prepare.sh'), '--pack', str(archive)]
            result = subprocess.run(prepare, env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(trace.read_text().splitlines()[0:2], ['engine 0', 'kokoro'])
            self.assertEqual(trace.read_text().splitlines()[-1], 'pod install')
            cached = subprocess.run(['sh', str(repo / 'scripts/prepare.sh'), '--pack', str(repo / 'missing.tar.gz')],
                                    env=environment, capture_output=True, text=True)
            self.assertEqual(cached.returncode, 0, cached.stderr)
            self.assertIn('already matches', cached.stdout)
            (pack / 'high/labels.bin').write_bytes(b'damaged cache')
            bad = repo / 'bad.tar.gz'
            with tarfile.open(bad, 'w:gz') as bundle:
                info = tarfile.TarInfo('../escape')
                info.size = 0
                bundle.addfile(info)
            rejected = subprocess.run(['sh', str(repo / 'scripts/prepare.sh'), '--pack', str(bad)],
                                      env=environment, capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual((pack / 'high/labels.bin').read_bytes(), b'damaged cache')
            repaired = subprocess.run(prepare, env=environment, capture_output=True, text=True)
            self.assertEqual(repaired.returncode, 0, repaired.stderr)
            self.assertEqual((pack / 'high/labels.bin').read_bytes(), labels)
