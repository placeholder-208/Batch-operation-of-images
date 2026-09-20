# QR Code Splitter

Batch QR code detection, decoding and splitting.

## Current version

The current local version uses:

- FastAPI
- OpenCV
- ZXing-C++

It can:

- detect multiple QR codes in one image
- decode QR contents
- return QR positions
- crop individual QR codes
- generate per-image ZIP files
- generate a combined ZIP file

## Migration

The project is being migrated toward:

Browser
    ↓
ZXing-C++ WebAssembly
    ↓
QR detection / decoding
    ↓
Canvas-based QR cropping
    ↓
ZIP generation
    ↓
Cloudflare Workers Static Assets

The existing FastAPI implementation is retained as the reference implementation during migration.