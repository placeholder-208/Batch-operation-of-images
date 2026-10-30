"""Prepare fixed matting models in /tmp; never replace application assets."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import time
import urllib.request

REVISION = 'fa2fa546052fba4c08921230a26cc69a333fca12'
FILES = {
    'onnx/model.onnx': (25888640, '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9'),
    'onnx/model_quantized.onnx': (6632188, '92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a'),
}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def download(url, path, expected=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and (expected is None or
            (path.stat().st_size == expected[0] and digest(path) == expected[1])):
        return
    temporary = path.with_suffix('.download')
    for attempt in range(3):
        try:
            print('Downloading', path.name, flush=True)
            with urllib.request.urlopen(url, timeout=180) as response, temporary.open('wb') as stream:
                shutil.copyfileobj(response, stream)
            if expected and (temporary.stat().st_size != expected[0] or digest(temporary) != expected[1]):
                raise ValueError('Model size or SHA-256 mismatch: ' + path.name)
            temporary.replace(path)
            return
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1)


def prepare(cache, include_slimsam=True):
    if include_slimsam:
        source = Path(__file__).resolve().parents[1] / 'prepare.py'
        spec = importlib.util.spec_from_file_location('slimsam_benchmark_prepare', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.prepare(cache)
    destination = cache / 'modnet'
    audit = {'repository': 'Xenova/modnet', 'revision': REVISION, 'license': 'Apache-2.0', 'files': {}}
    for name in [*FILES, 'config.json', 'preprocessor_config.json']:
        path = destination / name
        download(f'https://huggingface.co/Xenova/modnet/resolve/{REVISION}/{name}', path, FILES.get(name))
        audit['files'][name] = {'bytes': path.stat().st_size, 'sha256': digest(path),
                              'fits25MiB': path.stat().st_size <= 25 * 1024**2}
    audit['licenseSource'] = 'https://github.com/ZHKKKe/MODNet/blob/master/LICENSE'
    download('https://raw.githubusercontent.com/ZHKKKe/MODNet/master/LICENSE', destination / 'LICENSE.txt')
    (destination / 'audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    print('Ready:', destination, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/tmp/xincai-portrait-research/models'))
    parser.add_argument('--modnet-only', action='store_true')
    args = parser.parse_args()
    prepare(args.cache.resolve(), not args.modnet_only)
