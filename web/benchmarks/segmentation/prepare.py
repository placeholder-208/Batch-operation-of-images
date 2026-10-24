"""Download verified benchmark weights into /tmp, without replacing application assets."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request

REVISION = '5850ab45f587c112167512ffef949107115e26a0'
ROOT = Path(__file__).resolve().parents[2]
FILES = {
    'onnx/vision_encoder.onnx': (23276014, '9f8433273a6750b587779baa0cf5508111001bf7e7acfcf585d370139fd366d0'),
    'onnx/prompt_encoder_mask_decoder.onnx': (16557892, 'f4514391764fbd56e08e119060d874ecd7d52994bfb1968af159e12d4943b5bb'),
    'onnx/vision_encoder_quantized.onnx': (8882165, 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971'),
    'onnx/prompt_encoder_mask_decoder_quantized.onnx': (4903810, 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2'),
}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare(cache):
    destination = cache / 'slimsam'
    audit = {'repository': 'Xenova/slimsam-77-uniform', 'revision': REVISION, 'files': {}}
    for name, (size, checksum) in FILES.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.stat().st_size != size or digest(path) != checksum:
            temporary = path.with_suffix('.download')
            local = ROOT / 'models/segmentation/slimsam' / name
            if local.exists() and local.stat().st_size == size and digest(local) == checksum:
                shutil.copyfile(local, temporary)
            else:
                print(f'Downloading {name}', flush=True)
                url = f'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/{REVISION}/{name}'
                for attempt in range(3):
                    try:
                        if shutil.which('curl'):
                            subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error',
                                            '--retry', '2', '--max-time', '180', '--output', str(temporary), url], check=True)
                        else:
                            with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as output:
                                shutil.copyfileobj(response, output)
                        if temporary.stat().st_size != size or digest(temporary) != checksum:
                            raise ValueError(f'Incomplete or mismatched download: {name}')
                        break
                    except Exception:
                        if attempt == 2:
                            raise
                        print(f'Retrying {name} ({attempt + 2}/3)', flush=True)
                        time.sleep(1)
            if temporary.stat().st_size != size or digest(temporary) != checksum:
                raise ValueError(f'Checksum mismatch: {name}; original cache not overwritten')
            temporary.replace(path)
        audit['files'][name] = {'bytes': size, 'sha256': checksum, 'fits25MiB': size <= 25 * 1024**2}
    for name in ['config.json', 'preprocessor_config.json', 'LICENSE.txt']:
        source = ROOT / 'models/segmentation/slimsam' / name
        shutil.copyfile(source, destination / name)
        audit['files'][name] = {'bytes': source.stat().st_size, 'sha256': digest(source)}
    (destination / 'audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    print(f'Ready: {destination}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/tmp/xincai-model-eval/models'))
    prepare(parser.parse_args().cache.resolve())
