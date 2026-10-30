import { measure } from '../metrics.mjs';

const EDGE_RADIUS = 5;
const EDGE_OFFSETS = [];
for (let dy = -EDGE_RADIUS; dy <= EDGE_RADIUS; dy++) {
    for (let dx = -EDGE_RADIUS; dx <= EDGE_RADIUS; dx++) {
        if (dx * dx + dy * dy <= EDGE_RADIUS * EDGE_RADIUS) EDGE_OFFSETS.push([dx, dy]);
    }
}

/**
 * Score continuous portrait alpha without changing it or creating model prompts.
 *
 * Geometry is the existing IoU and boundary F1 at a two-pixel tolerance. SAD is
 * sum(abs(prediction - truth)) / 1000, with alpha in [0, 1]. Transition pixels
 * have strictly 0 < truth < 1. The edge band contains those pixels plus a
 * five-pixel Euclidean dilation of the truth's alpha >= 0.5 foreground boundary.
 * As in measure(), that boundary uses four neighbours and includes image edges.
 * Empty subsets have zero pixels and null errors, not a perfect score or NaN.
 * These are local alpha errors, not the matting benchmark's Grad/Conn metrics.
 */
export function measurePortrait(alpha, truth, width, height) {
    const n = width * height;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        !Number.isSafeInteger(n) || alpha == null || truth == null ||
        alpha.length !== n || truth.length !== n) {
        throw new Error('Invalid portrait metric dimensions');
    }

    // Reuse its validation of every alpha sample as well as its geometry scores.
    const geometry = measure(alpha, truth, width, height, 2);
    const band = new Uint8Array(n);
    const geometricBand = new Uint8Array(n);
    let absolute = 0, transitionAbsolute = 0, transitionSquared = 0, transitionPixels = 0;
    let coreTransitionAbsolute = 0, coreTransitionPixels = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x, t = truth[i], difference = alpha[i] - t;
            const error = Math.abs(difference);
            absolute += error;
            // A separate noise-resistant subset avoids treating every tiny
            // JPEG gray deviation as physically semitransparent hair.
            if (t > 0.05 && t < 0.95) { coreTransitionAbsolute += error; coreTransitionPixels++; }
            if (t > 0 && t < 1) {
                band[i] = 1;
                transitionAbsolute += error;
                transitionSquared += difference * difference;
                transitionPixels++;
            }
            if (t < 0.5 || !(x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
                truth[i - 1] < 0.5 || truth[i + 1] < 0.5 ||
                truth[i - width] < 0.5 || truth[i + width] < 0.5)) continue;

            // Build the band once. No nearest-edge search for each scored pixel.
            for (const [dx, dy] of EDGE_OFFSETS) {
                const xx = x + dx, yy = y + dy;
                if (xx >= 0 && xx < width && yy >= 0 && yy < height) band[yy * width + xx] = geometricBand[yy * width + xx] = 1;
            }
        }
    }

    let edgeAbsolute = 0, edgeSquared = 0, edgeBandPixels = 0;
    let geometricEdgeAbsolute = 0, geometricEdgePixels = 0;
    for (let i = 0; i < n; i++) {
        if (geometricBand[i]) { geometricEdgeAbsolute += Math.abs(alpha[i] - truth[i]); geometricEdgePixels++; }
        if (!band[i]) continue;
        const difference = alpha[i] - truth[i];
        edgeAbsolute += Math.abs(difference);
        edgeSquared += difference * difference;
        edgeBandPixels++;
    }
    return {
        ...geometry,
        sad: absolute / 1000,
        transitionMAE: transitionPixels ? transitionAbsolute / transitionPixels : null,
        transitionMSE: transitionPixels ? transitionSquared / transitionPixels : null,
        transitionPixels,
        edgeBandMAE: edgeBandPixels ? edgeAbsolute / edgeBandPixels : null,
        edgeBandMSE: edgeBandPixels ? edgeSquared / edgeBandPixels : null,
        edgeBandPixels,
        edgeBandRadiusPixels: EDGE_RADIUS,
        coreTransitionMAE: coreTransitionPixels ? coreTransitionAbsolute / coreTransitionPixels : null,
        coreTransitionPixels,
        coreTransitionRange: [0.05, 0.95],
        geometricEdgeMAE: geometricEdgePixels ? geometricEdgeAbsolute / geometricEdgePixels : null,
        geometricEdgePixels,
    };
}
