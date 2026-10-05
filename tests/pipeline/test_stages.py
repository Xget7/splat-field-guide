"""Stage commands bind photo names and bytes to their downstream artifacts."""

import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))


class StageTests(unittest.TestCase):
    def test_ingest_is_idempotent_and_refuses_an_unrecorded_capture_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            photos = root / 'photos'
            photos.mkdir()
            # Use the shipped JPEG metadata, without copying a full capture.
            source = next((ROOT / 'data/capture/jpg').glob('*.jpg'))
            (photos / 'one.jpg').write_bytes(source.read_bytes())
            command = [sys.executable, str(ROOT / 'pipeline/ingest.py'), '--source', str(photos), '--out', str(root / 'capture')]
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            receipt = (root / 'capture/capture.json').read_bytes()
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual((root / 'capture/capture.json').read_bytes(), receipt)
            (photos / 'two.jpg').write_bytes(source.read_bytes())
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual((root / 'capture/capture.json').read_bytes(), receipt)

    def test_pose_rejection_distinguishes_missing_and_split_models(self):
        import poses
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            photos = root / 'photos'
            photos.mkdir()
            (photos / 'one.jpg').write_bytes(b'photo')
            for models, error in [(0, 'no reconstruction'), (2, 'multiple models')]:
                def run(command, **kwargs):
                    if command[1] == 'mapper':
                        sparse = pathlib.Path(command[command.index('--output_path') + 1])
                        for index in range(models):
                            (sparse / str(index)).mkdir()
                with patch.object(poses.subprocess, 'check_output', return_value='COLMAP 4.2.0'), \
                        patch.object(poses.subprocess, 'run', side_effect=run):
                    with self.assertRaisesRegex(ValueError, error):
                        poses.recover(photos, root / 'output')
                self.assertFalse((root / 'output').exists())

    def test_ingest_refuses_an_output_inside_its_source(self):
        import ingest
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory)
            photo = next((ROOT / 'data/capture/jpg').glob('*.jpg'))
            (source / 'one.jpg').write_bytes(photo.read_bytes())
            with patch.object(ingest.shutil, 'copytree', side_effect=AssertionError('copy must not start')):
                with self.assertRaisesRegex(ValueError, 'inside its source'):
                    ingest.ingest(source, source / 'output')
            self.assertFalse((source / 'output').exists())

    def test_tracker_cameras_reject_changed_photo_bytes(self):
        import sam_track
        with tempfile.TemporaryDirectory() as directory:
            photo_dir = pathlib.Path(directory)
            names = sorted((ROOT / 'data/capture/jpg').glob('*.jpg'))
            for photo in names:
                (photo_dir / photo.name).write_bytes(b'changed')
            from unittest.mock import patch
            with patch.object(sam_track, 'PHOTOS', photo_dir):
                with self.assertRaisesRegex(Exception, 'capture'):
                    sam_track.plan('engine')

