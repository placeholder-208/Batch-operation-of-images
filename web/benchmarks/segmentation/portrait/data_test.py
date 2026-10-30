import importlib.util
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location('portrait_data', Path(__file__).with_name('prepare-data.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DataTest(unittest.TestCase):
    def test_jpeg_dimensions_skip_metadata_and_read_sof(self):
        metadata = b'\xff\xe0' + struct.pack('>H', 6) + b'ABCD'
        for marker in [0xC0, 0xC2]:
            sof = b'\xff' + bytes([marker]) + struct.pack('>HBHH', 8, 8, 1234, 2345)
            self.assertEqual(module.jpeg_dimensions(b'\xff\xd8' + metadata + sof), (2345, 1234))

    def test_non_jpeg_or_missing_dimensions_fails(self):
        for data in [b'not a jpeg', b'\xff\xd8', b'\xff\xd8\xff\xd9']:
            with self.assertRaises(ValueError):
                module.jpeg_dimensions(data)

    def test_seek_outside_archive_and_large_read_fail_before_network(self):
        remote = module.RemoteZip(size=100_000_000)
        self.assertEqual(remote.seek(-10, 2), 99_999_990)
        self.assertEqual(remote.seek(-20, 1), 99_999_970)
        with self.assertRaises(ValueError):
            remote.seek(-1)
        remote.seek(0)
        with self.assertRaises(ValueError):
            remote.read()


if __name__ == '__main__':
    unittest.main()
