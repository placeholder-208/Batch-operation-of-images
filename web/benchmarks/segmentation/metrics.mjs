// Geometry metrics, not the matting benchmark's Grad/Conn metrics.
export function measure(prediction, truth, width, height, tolerance = 2) {
    const n = width * height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        prediction.length !== n || truth.length !== n || !Number.isInteger(tolerance) || tolerance < 0)
        throw new Error('Invalid metric dimensions');
    const a = new Uint8Array(n), b = new Uint8Array(n);
    let intersection = 0, union = 0, absolute = 0, squared = 0;
    for (let i = 0; i < n; i++) {
        const p = prediction[i], t = truth[i];
        if (!Number.isFinite(p) || !Number.isFinite(t) || p < 0 || p > 1 || t < 0 || t > 1)
            throw new Error('Alpha must be finite and within [0,1]');
        a[i] = p >= .5; b[i] = t >= .5;
        intersection += a[i] & b[i]; union += a[i] | b[i];
        absolute += Math.abs(p - t); squared += (p - t) ** 2;
    }
    function edge(mask) {
        const result = [];
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (mask[i] && (x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
                !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width])) result.push(i);
        }
        return result;
    }
    const ae = edge(a), be = edge(b);
    function matched(source, target) {
        const bitmap = new Uint8Array(n); for (const i of target) bitmap[i] = 1;
        let count = 0;
        for (const i of source) {
            const x = i % width, y = Math.floor(i / width); let found = false;
            for (let yy = Math.max(0, y - tolerance); yy <= Math.min(height - 1, y + tolerance) && !found; yy++)
                for (let xx = Math.max(0, x - tolerance); xx <= Math.min(width - 1, x + tolerance); xx++)
                    if ((xx - x) ** 2 + (yy - y) ** 2 <= tolerance ** 2 && bitmap[yy * width + xx]) { found = true; break; }
            count += found;
        }
        return count;
    }
    const precision = ae.length ? matched(ae, be) / ae.length : (be.length ? 0 : 1);
    const recall = be.length ? matched(be, ae) / be.length : (ae.length ? 0 : 1);
    return { iou: union ? intersection / union : 1, boundaryPrecision: precision, boundaryRecall: recall,
        boundaryF1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
        alphaMAE: absolute / n, alphaMSE: squared / n, tolerancePixels: tolerance };
}
export function truthBox(alpha, width, height) {
    if (alpha.length !== width * height) throw new Error('Invalid mask dimensions');
    let l = width, t = height, r = 0, b = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (alpha[y * width + x] > 0) {
        l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x + 1); b = Math.max(b, y + 1);
    }
    if (r <= l) throw new Error('Ground truth is empty');
    return [l, t, r, b];
}
