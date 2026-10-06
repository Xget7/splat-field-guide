"""The marking HTTP interface restores durable capture-bound prompts."""

import pathlib
import tempfile
import unittest

from fastapi.testclient import TestClient
from PIL import Image
from pipeline.pack import live_api
from pipeline.pack import mask_tools
class FakeSam:
    fail = False

    async def warm(self):
        return 'fake'

    async def segment(self, frame, marks, capture=None):
        if self.fail:
            raise RuntimeError('SAM failed')
        if not marks['clicks'] and not marks.get('box'):
            return {'png': None, 'score': 0.0}
        return {'png': mask_tools.mask_png([[True, False], [False, False]]), 'score': 0.5}


class MaskTests(unittest.TestCase):
    def test_reopen_and_failed_replacement_keep_saved_prompts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            photos = root / 'photos'
            photos.mkdir()
            for frame in range(124):
                Image.new('RGB', (2, 2)).save(photos / f'{frame:05d}.jpg')
            sam = FakeSam()
            client = TestClient(live_api.make_app(sam, photos, root / 'page.html', root / 'marks'))
            config = client.get('/api/config').json()
            prompt = {'clicks': [{'x': 0.2, 'y': 0.3, 'positive': True}], 'box': None}
            request = {'part': 'engine', 'capture': config.get('capture'), 'photos': {'0': prompt}}
            self.assertEqual(client.post('/api/save', json=request).status_code, 200)
            reopened = client.get('/api/config').json()
            self.assertEqual(reopened['marks']['engine']['photos'], {'0': prompt})
            request['revision'] = reopened['marks']['engine']['revision']
            sam.fail = True
            failed = client.post('/api/save', json={**request, 'photos': {'5': prompt}})
            self.assertEqual(failed.status_code, 503)
            self.assertEqual(client.get('/api/config').json()['marks']['engine']['photos'], {'0': prompt})
            sam.fail = False
            self.assertEqual(client.post('/api/save', json={**request, 'capture': 'foreign'}).status_code, 409)
            self.assertEqual(client.post('/api/save', json={**request, 'photos': {}}).status_code, 200)
            self.assertEqual(client.get('/api/config').json()['marks']['engine']['photos'], {})

    def test_volume_diagnostic_reads_the_selected_saved_revision(self):
        import json
        import shutil
        import subprocess
        from unittest.mock import patch
        from pipeline.pack import preflight
        from pipeline import artifacts
        source = pathlib.Path(__file__).resolve().parents[2] / 'data/segment/marks'
        capture = artifacts.capture(preflight.PHOTOS)['sha256']
        def run(command, **kwargs):
            if command[2] == 'get':
                target = pathlib.Path(command[-1]) / 'marks'
                for part in source.iterdir():
                    if not part.is_dir():
                        continue
                    revision = 'a' * 32
                    saved = target / part.name / 'sets' / revision
                    shutil.copytree(part, saved)
                    marks = json.loads((saved / 'marks.json').read_text())
                    marks['capture'] = capture
                    (saved / 'marks.json').write_text(json.dumps(marks))
                    (target / part.name / 'current.json').write_text(json.dumps({'revision': revision}))
                return subprocess.CompletedProcess(command, 0, '', '')
            return subprocess.CompletedProcess(command, 0, '.jpg\n' * 124, '')
        with patch.object(preflight.subprocess, 'run', side_effect=run), patch.object(preflight, 'results', []):
            preflight.check_volume()
            self.assertEqual(len(preflight.results), 2)
            self.assertTrue(all(ok for ok, _ in preflight.results), preflight.results)

class StorageFailureTests(unittest.TestCase):
    def test_failed_volume_commit_preserves_the_previous_set(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            photos = root / 'photos'
            photos.mkdir()
            for frame in range(124):
                Image.new('RGB', (2, 2)).save(photos / f'{frame:05d}.jpg')
            client = TestClient(live_api.make_app(FakeSam(), photos, root / 'page', root / 'marks'))
            capture = client.get('/api/config').json()['capture']
            prompt = {'clicks': [{'x': 0.2, 'y': 0.3, 'positive': True}], 'box': None}
            request = {'capture': capture, 'part': 'engine', 'photos': {'0': prompt}}
            first = client.post('/api/save', json=request).json()
            calls = 0

            def failing_commit():
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError('volume commit failed')

            client = TestClient(live_api.make_app(FakeSam(), photos, root / 'page', root / 'marks', commit=failing_commit))
            response = client.post('/api/save', json={**request, 'revision': first['revision'], 'photos': {'5': prompt}})
            self.assertEqual(response.status_code, 503)
            reopened = client.get('/api/config').json()['marks']['engine']
            self.assertEqual(reopened['revision'], first['revision'])
            self.assertEqual(reopened['photos'], {'0': prompt})
            self.assertEqual(client.get('/mask/engine/0.png').status_code, 200)


if __name__ == '__main__':
    unittest.main()
