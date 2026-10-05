"""Verify the publication interface against the consumer and a temporary filesystem."""

import pathlib
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'pipeline'))
import export_checks


class PublicationTests(unittest.TestCase):
    def test_consumer_rejects_the_reserved_tour_procedure(self):
        manifest = export_checks.sample_manifest()
        manifest['procedures'][0]['id'] = 'tour'
        with self.assertRaisesRegex(Exception, 'reservedProcedureId'):
            export_checks.parse_pack(manifest)

    def test_missing_pack_never_passes_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(export_checks.HERE / 'export_checks.py'),
                                     '--pack', directory], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0, result.stdout)

class SourceContractTests(unittest.TestCase):
    def test_foreign_part_mapping_is_rejected_by_the_consumer(self):
        manifest = export_checks.sample_manifest()
        manifest['sources'] = {
            'captureSha256': 'a' * 64, 'reconstructionSha256': 'b' * 64,
            'ply': {'path': 'source.ply', 'bytes': 1, 'sha256': 'c' * 64},
            'labels': {'path': 'labels.npy', 'bytes': 1, 'sha256': 'd' * 64},
            'liftingReport': {'path': 'report.json', 'bytes': 1, 'sha256': 'e' * 64},
            'content': {'path': 'pack.yaml', 'bytes': 1, 'sha256': 'f' * 64},
            'knowledge': {'path': 'knowledge.md', 'bytes': 1, 'sha256': '0' * 64},
            'partLabels': {'engine': 1},
        }
        with self.assertRaisesRegex(Exception, 'partLabels'):
            export_checks.parse_pack(manifest)

class ExportFailureTests(unittest.TestCase):
    def test_failed_export_keeps_the_published_pack(self):
        import json
        import numpy as np
        from unittest.mock import patch
        import yaml
        import export
        import lift

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            ply = root / 'source.ply'
            names = ['x', 'y', 'z', 'opacity'] + [f'f_dc_{i}' for i in range(3)]
            names += [f'scale_{i}' for i in range(3)] + [f'rot_{i}' for i in range(4)]
            rows = np.zeros(80, dtype=[(name, '<f4') for name in names])
            rng = np.random.default_rng(42)
            for name in 'xyz':
                rows[name] = rng.normal(size=80)
            rows['rot_0'] = 1
            for i in range(3):
                rows[f'scale_{i}'] = -5
            header = 'ply\nformat binary_little_endian 1.0\nelement vertex 80\n'
            header += ''.join(f'property float {name}\n' for name in names) + 'end_header\n'
            ply.write_bytes(header.encode() + rows.tobytes())
            labels = root / 'labels.npy'
            np.save(labels, np.tile(np.arange(1, 9, dtype=np.uint8), 10))
            mapping = {p['id']: i + 1 for i, p in enumerate(yaml.safe_load(export.CONTENT.read_text())['parts'])}
            import artifacts
            report = {'labels': mapping, 'labels_sha256': artifacts.sha256(labels),
                      'sources': {'ply_sha256': artifacts.sha256(ply),
                                  'capture_sha256': artifacts.capture(lift.PHOTOS)['sha256'],
                                  'reconstruction_sha256': artifacts.reconstruction(lift.SPARSE)['sha256']}}
            (root / 'report.json').write_text(json.dumps(report))
            out = root / 'pack'
            (out / 'high').mkdir(parents=True)
            (out / 'manifest.json').write_text('last good manifest')
            (out / 'high/cloud.spz').write_bytes(b'last good cloud')
            # Missing authored knowledge is a real late failure after encoding.
            with patch.object(sys, 'argv', ['export.py', '--replace', '--ply', str(ply), '--labels', str(labels), '--out', str(out)]), \
                    patch.object(export, 'KNOWLEDGE', root / 'missing.md'):
                with self.assertRaises(FileNotFoundError):
                    export.main()
            self.assertEqual((out / 'high/cloud.spz').read_bytes(), b'last good cloud')
            self.assertEqual((out / 'manifest.json').read_text(), 'last good manifest')


if __name__ == '__main__':
    unittest.main()
