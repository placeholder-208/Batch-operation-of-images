"""Local-only benchmark server. Run prepare.py separately before benchmarking."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, cache, **kwargs):
        self.cache = cache
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        pathname = unquote(urlsplit(path).path)
        prefix = '/_benchmark-models/'
        if pathname.startswith(prefix):
            target = (self.cache / pathname[len(prefix):]).resolve()
            return str(target if target.is_relative_to(self.cache) else self.cache / '__invalid__')
        return super().translate_path(path)

    def send_head(self):
        parts = Path(unquote(urlsplit(self.path).path)).parts
        if any(part.startswith('.') or part in {'server', 'worker.js', 'wrangler.jsonc'} for part in parts if part != '/'):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, 'Directory listing disabled')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/tmp/xincai-model-eval/models'))
    parser.add_argument('--port', type=int, default=8767)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, cache=args.cache.resolve()))
    print(f'http://127.0.0.1:{args.port}/benchmarks/segmentation/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
