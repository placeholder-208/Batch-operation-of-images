"""Fetch a deterministic research-only PPM-100 subset using validated ZIP ranges.

No images or alpha annotations are added to the application or Git. Official
PPM alpha annotations are CC BY-NC-SA 4.0; keep their original JPEG bytes.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import struct
import time
import urllib.request
import zipfile

SOURCE = 'https://github.com/ZHKKKe/PPM'
URL = ('https://drive.usercontent.google.com/download?'
       'id=1JUx-EPoV9QAhQgmW0AyOen-xKQUzZia-&export=download&confirm=t')
EXPECTED_SIZE = 262319198
INDICES = list(range(0, 100, 10))


class RemoteZip(io.RawIOBase):
    def __init__(self, url=URL, size=EXPECTED_SIZE):
        self.url, self.size, self.position = url, size, 0
        self.transferred = 0

    def seekable(self):
        return True

    def seek(self, offset, whence=0):
        self.position = offset + (0 if whence == 0 else self.position if whence == 1 else self.size)
        if self.position < 0 or self.position > self.size:
            raise ValueError('Seek outside archive')
        return self.position

    def tell(self):
        return self.position

    def read(self, length=-1):
        length = min(self.size - self.position, self.size if length < 0 else length)
        if length == 0:
            return b''
        if length > 32 * 1024**2:
            raise ValueError('Unexpected large ZIP read')
        start, end = self.position, self.position + length - 1
        # Separate range URLs also avoid intermediaries reusing a cached 206
        # response for a different Range header.
        url = self.url + f'&xincai_range={start}-{end}'
        request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    expected = f'bytes {start}-{end}/{self.size}'
                    if response.status != 206 or response.headers.get('Content-Range') != expected:
                        raise ValueError('Server did not honor exact range: ' + str(response.headers.get('Content-Range')))
                    data = response.read(length + 1)
                if len(data) != length:
                    raise ValueError('Truncated range')
                self.position += length
                self.transferred += length
                return data
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1)


def jpeg_dimensions(data):
    if data[:2] != b'\xff\xd8':
        raise ValueError('Expected original JPEG')
    stream = io.BytesIO(data)
    stream.seek(2)
    while True:
        marker = stream.read(1)
        if not marker:
            raise ValueError('Missing JPEG dimensions')
        if marker != b'\xff':
            continue
        code = stream.read(1)
        while code == b'\xff':
            code = stream.read(1)
        if code == b'\xd9' or code == b'\xda':
            raise ValueError('Missing JPEG SOF')
        if code[0] in (0x01, *range(0xD0, 0xD9)):
            continue
        length = struct.unpack('>H', stream.read(2))[0]
        if code[0] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            _, height, width = struct.unpack('>BHH', stream.read(5))
            return width, height
        stream.seek(length - 2, 1)


def prepare(destination, listing=False):
    remote = RemoteZip()
    with zipfile.ZipFile(remote) as archive:
        entries = archive.infolist()
        if listing:
            for index, entry in enumerate(entries):
                print(index, entry.filename, entry.file_size)
            return
        images = [e for e in entries if '/image/' in e.filename.lower() and e.filename.lower().endswith('.jpg')]
        if len(images) != 100:
            raise ValueError('Unexpected PPM image directory/count; inspect --list first')
        manifest = {'dataset': 'PPM-100', 'source': SOURCE, 'archiveUrl': URL,
                    'archiveBytes': EXPECTED_SIZE, 'selection': 'image entries in ZIP order at zero-based indices 0,10,...,90; fixed before inference',
                    'selectedIndices': INDICES, 'alphaLicense': 'CC-BY-NC-SA-4.0',
                    'imageLicense': 'See official PPM Flickr attribution/license information',
                    'purpose': 'local non-commercial research only; not application assets',
                    'groundTruthFormat': 'original official JPEG alpha; continuous grayscale, includes JPEG compression artifacts',
                    'samples': []}
        names = {e.filename for e in entries}
        for index in INDICES:
            entry = images[index]
            alpha_name = entry.filename.replace('/image/', '/matte/')
            if alpha_name not in names:
                raise ValueError('Cannot identify matching official alpha: ' + entry.filename)
            record = {'id': PurePosixPath(entry.filename).stem, 'archiveImageIndex': index}
            dimensions = []
            for kind, name in [('image', entry.filename), ('alpha', alpha_name)]:
                relative = f'{kind}/{PurePosixPath(name).name}'
                target = destination / relative
                if target.exists():
                    data = target.read_bytes()
                    import zlib
                    if zlib.crc32(data) != archive.getinfo(name).CRC:
                        raise ValueError('Cached sample CRC mismatch: ' + str(target))
                else:
                    print('Downloading', name, flush=True)
                    data = archive.read(name)  # zipfile verifies original entry CRC
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                dimensions.append(jpeg_dimensions(data))
                record[kind] = relative
                record[kind + 'SourceEntry'] = name
                record[kind + 'Bytes'] = len(data)
                record[kind + 'Sha256'] = hashlib.sha256(data).hexdigest()
            if dimensions[0] != dimensions[1]:
                raise ValueError('Official pair dimensions mismatch: ' + record['id'])
            record['width'], record['height'] = dimensions[0]
            manifest['samples'].append(record)
        manifest['transferredBytesThisRun'] = remote.transferred
        destination.mkdir(parents=True, exist_ok=True)
        (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print('Ready:', destination, 'pairs:', len(manifest['samples']), 'range bytes:', remote.transferred, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, default=Path('/tmp/xincai-portrait-research/data'))
    parser.add_argument('--list', action='store_true')
    args = parser.parse_args()
    prepare(args.destination.resolve(), args.list)
