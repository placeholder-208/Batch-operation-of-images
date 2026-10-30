"""Test the portrait research mounts without network or real model weights."""
import importlib.util
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('portrait_server', Path(__file__).with_name('serve.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.models, self.data = root / 'models', root / 'data'
        self.models.mkdir()
        self.data.mkdir()
        (self.models / 'audit.json').write_text('{"model":"fixture"}')
        (self.data / 'manifest.json').write_text('{"dataset":"fixture"}')
        (root / 'outside.txt').write_text('not accessible')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(module.Handler, models=self.models, data=self.data))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def test_page_models_and_data_aliases(self):
        for path, expected in [('/benchmarks/segmentation/portrait/', b'benchmark.mjs'),
                               ('/_benchmark-models/audit.json', b'fixture'),
                               ('/_portrait-data/manifest.json', b'fixture')]:
            with urllib.request.urlopen(self.base + path) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(expected, response.read())
                self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_both_mounts_reject_encoded_escape_and_listing(self):
        for prefix in ['/_benchmark-models/', '/_portrait-data/']:
            for path, status in [(prefix + '%2e%2e/outside.txt', 404), (prefix, 403)]:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(self.base + path)
                self.assertEqual(error.exception.code, status)

    def test_application_secrets_and_worker_sources_are_not_served(self):
        for path in ['/.git/config', '/.dev.vars', '/server/semantic.js', '/worker.js', '/wrangler.jsonc']:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(self.base + path)
            self.assertEqual(error.exception.code, 404)


if __name__ == '__main__':
    unittest.main()
