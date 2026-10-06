"""Stage commands bind photo names and bytes to their downstream artifacts."""

import pathlib
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def write_photo(path):
    from PIL import Image
    from pipeline.pack import export
    note = export.APPLE_MAKER_NOTE + b'\x00\x01MM' + struct.pack('>H', 1)
    note += struct.pack('>HHII', export.APPLE_ACCELERATION, export.EXIF_SRATIONAL, 3, 32)
    note += bytes(4) + struct.pack('>6i', 0, 1, -1, 1, 0, 1)
    exif = Image.Exif()
    exif[export.EXIF_IFD] = {export.EXIF_MAKER_NOTE: note}
    Image.new('RGB', (8, 4)).save(path, exif=exif)


class StageTests(unittest.TestCase):
    def test_ingest_is_idempotent_and_refuses_an_unrecorded_capture_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            photos = root / 'photos'
            photos.mkdir()
            source = photos / 'one.jpg'
            write_photo(source)
            command = [sys.executable, '-m', 'pipeline.pack.ingest', '--source', str(photos), '--out', str(root / 'capture')]
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            receipt = (root / 'capture/capture.json').read_bytes()
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual((root / 'capture/capture.json').read_bytes(), receipt)
            (photos / 'two.jpg').write_bytes(source.read_bytes())
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual((root / 'capture/capture.json').read_bytes(), receipt)

    def test_pose_rejection_distinguishes_missing_and_split_models(self):
        from pipeline.pack import poses
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
        from pipeline.pack import ingest
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory)
            write_photo(source / 'one.jpg')
            with patch.object(ingest.shutil, 'copytree', side_effect=AssertionError('copy must not start')):
                with self.assertRaisesRegex(ValueError, 'inside its source'):
                    ingest.ingest(source, source / 'output')
            self.assertFalse((source / 'output').exists())

    def test_tracker_cameras_reject_changed_photo_bytes(self):
        from pipeline.pack import sam_track
        from pipeline import artifacts
        import json
        with tempfile.TemporaryDirectory() as directory:
            photo_dir = pathlib.Path(directory)
            photo = photo_dir / 'one.jpg'
            write_photo(photo)
            (photo_dir / 'cameras.json').write_text(json.dumps({
                'captureSha256': artifacts.capture(photo_dir)['sha256'],
            }))
            photo.write_bytes(b'changed')
            from unittest.mock import patch
            with patch.object(sam_track, 'PHOTOS', photo_dir), patch.object(sam_track, 'HERE', photo_dir):
                with self.assertRaisesRegex(Exception, 'capture'):
                    sam_track.plan('engine')

class ReferenceRecipeTests(unittest.TestCase):
    def test_reference_training_plan_records_front_angles_without_training(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / 'engine.usdz'
            source.write_bytes(b'fixture')
            result = subprocess.run([sys.executable, '-m', 'pipeline.ar.train_reference', '--source', str(source),
                                     '--output', str(root / 'engine.referenceobject'), '--angles', 'front', '--plan'],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            command = json.loads(result.stdout)['command']
            self.assertIn('--front', command)
            self.assertNotIn('--upright', command)
            self.assertFalse((root / 'engine.referenceobject').exists())

class LandmarkPublicationTests(unittest.TestCase):
    def test_changed_reference_model_cannot_reuse_authored_landmarks(self):
        import json
        from pipeline import artifacts
        from pipeline.ar import publish_landmarks
        from pipeline.pack import export_checks
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            model = root / 'medium.usdz'
            model.write_bytes(b'original model')
            raw = root / 'raw.json'
            raw.write_text(json.dumps({'sourceModel': str(model), 'sourceModelSHA256': artifacts.sha256(model),
                                       'authoringViewport': [1200, 900],
                                       'landmarks': [{'id': 'cap', 'label': 'Cap', 'color': [1, 0, 0],
                                                      'position': [12, 4, 6], 'sourcePixel': [20, 30]}]}))
            poses = root / 'medium.poses.json'
            poses.write_text('{}')
            manifest = export_checks.sample_manifest()
            manifest['sources'] = {'captureSha256': 'a' * 64, 'reconstructionSha256': 'b' * 64,
                                   'partLabels': {p['id']: p['label'] for p in manifest['parts']},
                                   **{key: {'path': 'source.bin', 'bytes': 1, 'sha256': 'c' * 64}
                                      for key in ['ply', 'labels', 'liftingReport', 'content', 'knowledge']}}
            pack = root / 'manifest.json'
            pack.write_text(json.dumps(manifest))
            report = root / 'publication.json'
            report.write_text(json.dumps({'sources': manifest['sources']}))
            registration = root / 'registration.json'
            registration.write_text(json.dumps({'matrixOrder': 'rows', 'status': 'candidate_unverified',
                'inputs': {key: {'path': str(path), 'sha256': artifacts.sha256(path)}
                           for key, path in [('poses', poses), ('packReport', report)]},
                'rawReferenceFromPack': [[2, 0, 0, 10], [0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]]}))
            model.write_bytes(b'changed model')
            with self.assertRaisesRegex(ValueError, 'model identity'):
                publish_landmarks.publish(raw, registration, pack, root / 'candidate.json')
            model.write_bytes(b'original model')
            result = publish_landmarks.publish(raw, registration, pack, root / 'candidate.json')
            self.assertEqual(result['landmarks'][0]['position'], [1., 2., 3.])
