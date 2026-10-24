"""Serve the current workspace for local browser evaluation."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[2]

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, url):
        name = unquote(urlsplit(url).path).lstrip('/')
        target = (ROOT / name).resolve()
        return str(target if target.is_relative_to(ROOT) else ROOT / '__invalid__')

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8768), Handler).serve_forever()
