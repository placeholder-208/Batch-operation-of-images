function pixelCount(width, height) {
    const count = width * height;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        !Number.isSafeInteger(count)) throw new Error('Invalid alpha dimensions');
    return count;
}

function validateAlpha(alpha, width, height) {
    const count = pixelCount(width, height);
    if (alpha == null || alpha.length !== count) throw new Error('Alpha length does not match dimensions');
    for (let i = 0; i < count; i++) {
        if (!Number.isFinite(alpha[i]) || alpha[i] < 0 || alpha[i] > 1)
            throw new Error('Alpha must be finite and within [0,1]');
    }
    return count;
}

/** Resize actual alpha, not SAM logits, without thresholding or 8-bit rounding. */
export function resizeAlphaBilinear(source, sw, sh, dw, dh) {
    validateAlpha(source, sw, sh);
    const count = pixelCount(dw, dh);
    if (sw === dw && sh === dh) return Float32Array.from(source);

    const result = new Float32Array(count);
    const scaleX = sw / dw, scaleY = sh / dh;
    for (let y = 0; y < dh; y++) {
        // Pixel-centre alignment, extending border pixels beyond their centres.
        const sy = Math.max(0, Math.min(sh - 1, (y + .5) * scaleY - .5));
        const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
        for (let x = 0; x < dw; x++) {
            const sx = Math.max(0, Math.min(sw - 1, (x + .5) * scaleX - .5));
            const x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
            const topLeft = source[y0 * sw + x0], bottomLeft = source[y1 * sw + x0];
            const top = topLeft + (source[y0 * sw + x1] - topLeft) * fx;
            const bottom = bottomLeft + (source[y1 * sw + x1] - bottomLeft) * fx;
            result[y * dw + x] = top + (bottom - top) * fy;
        }
    }
    return result;
}

/**
 * Opaque 8-bit grayscale for saving a visual preview only. Metrics must receive
 * the original continuous alpha; this conversion intentionally loses precision.
 */
export function alphaToRgba(alpha, width, height) {
    const count = validateAlpha(alpha, width, height);
    const rgba = new Uint8ClampedArray(count * 4);
    for (let i = 0; i < count; i++) {
        const gray = Math.round(alpha[i] * 255), j = i * 4;
        rgba[j] = rgba[j + 1] = rgba[j + 2] = gray;
        rgba[j + 3] = 255;
    }
    return rgba;
}
