import functools
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from serve import Handler


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.cache = Path(self.directory.name)
        (self.cache / 'slimsam').mkdir()
        (self.cache / 'slimsam/audit.json').write_text('{"verified": true}')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, cache=self.cache))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def test_page_and_model_alias(self):
        with urllib.request.urlopen(self.base + '/benchmarks/segmentation/') as response:
            self.assertIn('本地分割模型评估', response.read().decode())
        with urllib.request.urlopen(self.base + '/_benchmark-models/slimsam/audit.json') as response:
            self.assertEqual(response.read(), b'{"verified": true}')
            self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_alias_traversal_and_directory_listing_are_rejected(self):
        for path in ['/_benchmark-models/%2e%2e/serve.py', '/_benchmark-models/', '/.git/config', '/server/semantic.js']:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(self.base + path)
            self.assertIn(error.exception.code, (403, 404))


if __name__ == '__main__':
    unittest.main()
