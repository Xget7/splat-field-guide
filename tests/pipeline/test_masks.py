"""The marking HTTP interface restores durable capture-bound prompts."""

import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'pipeline'))
from fastapi.testclient import TestClient
from PIL import Image
import live_api
import mask_tools


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

    async def save(self, request):
        return list(request['photos'])


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


if __name__ == '__main__':
    unittest.main()

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
