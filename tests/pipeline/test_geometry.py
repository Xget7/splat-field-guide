"""Malformed source artifacts terminate, and diagnostic previews honor photo layout."""

import pathlib
import struct
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'pipeline'))
import lift
import export_checks


class GeometryTests(unittest.TestCase):
    def test_truncated_source_readers_fail_without_hanging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'cloud.ply').write_bytes(b'ply\nelement vertex 1\n')
            (root / 'cameras.bin').write_bytes(struct.pack('<Q', 1) + struct.pack('<iiQQ8d', 1, 4, 8, 4, *([1.] * 8)))
            (root / 'images.bin').write_bytes(struct.pack('<Q', 1) + struct.pack('<idddddddi', 1, 1., 0., 0., 0., 0., 0., 0., 1) + b'unterminated')
            for invocation in [f"lift.read_ply(Path({str(root / 'cloud.ply')!r}))", f"lift.read_cameras(Path({str(root)!r}))"]:
                code = f"import sys; sys.path.insert(0, {str(ROOT / 'pipeline')!r}); from pathlib import Path; import lift; {invocation}"
                try:
                    result = subprocess.run([sys.executable, '-c', code], capture_output=True, timeout=2)
                except subprocess.TimeoutExpired:
                    self.fail('truncated source reader did not terminate')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b'truncated', result.stderr)

    def test_preview_keeps_the_actual_photo_orientation(self):
        with tempfile.TemporaryDirectory() as directory:
            photo = pathlib.Path(directory) / 'photo.jpg'
            Image.new('RGB', (8, 4)).save(photo)
            camera = (8, 4, (4., 4., 4., 2., 0., 0., 0., 0.))
            scene = lift.Scene(np.array([[-.5, 0., 1.], [.5, 0., 1.]]), np.ones(2) * .5,
                               np.ones((2, 3)) * .5, [(np.eye(3), np.zeros(3), camera)], [photo])
            preview = scene.preview(0, np.zeros((4, 8), bool), np.zeros((1, 2), bool), np.zeros((1, 2), bool))
            self.assertEqual(preview.shape[:2], (1, 4))

    def test_spz_v2_is_rejected_before_v3_quaternion_decoding(self):
        import gzip
        data = gzip.compress(struct.pack('<IIIBBBB', 0x5053474E, 2, 1, 0, 12, 0, 0) + bytes(19))
        with self.assertRaisesRegex(AssertionError, 'version 2'):
            export_checks.read_spz(data)
