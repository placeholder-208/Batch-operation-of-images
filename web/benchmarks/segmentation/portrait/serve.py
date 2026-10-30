"""Local-only portrait research server; models/data remain outside application assets."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[3]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, models, data, **kwargs):
        self.mounts = {'/_benchmark-models/': models, '/_portrait-data/': data}
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        pathname = unquote(urlsplit(path).path)
        for prefix, root in self.mounts.items():
            if pathname.startswith(prefix):
                target = (root / pathname[len(prefix):]).resolve()
                return str(target if target.is_relative_to(root) else root / '__invalid__')
        return super().translate_path(path)

    def send_head(self):
        parts = Path(unquote(urlsplit(self.path).path)).parts
        if any(p.startswith('.') or p in {'server', 'worker.js', 'wrangler.jsonc'} for p in parts if p != '/'):
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
    parser.add_argument('--models', type=Path, default=Path('/tmp/xincai-portrait-research/models'))
    parser.add_argument('--data', type=Path, default=Path('/tmp/xincai-portrait-research/data'))
    parser.add_argument('--port', type=int, default=8771)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, models=args.models.resolve(), data=args.data.resolve()))
    print(f'http://127.0.0.1:{args.port}/benchmarks/segmentation/portrait/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
