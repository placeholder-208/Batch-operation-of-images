"""Mount a single local test photo without copying it into deployable assets."""
import argparse
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from functools import partial
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[4]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,image,**kwargs):
        self.image=image
        super().__init__(*args,directory=str(ROOT),**kwargs)
    def translate_path(self,path):
        if urlsplit(path).path=='/_dense-test/input.jpg':return str(self.image)
        prefix='/_baseline-js/'
        if urlsplit(path).path.startswith(prefix):
            root=Path('/tmp/xincai-dense-baseline-js')
            target=(root/urlsplit(path).path[len(prefix):]).resolve()
            return str(target if target.is_relative_to(root) else root/'__invalid__')
        return super().translate_path(path)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('image',type=Path);parser.add_argument('--port',type=int,default=8773)
    args=parser.parse_args()
    ThreadingHTTPServer(('127.0.0.1',args.port),partial(Handler,image=args.image.resolve())).serve_forever()
