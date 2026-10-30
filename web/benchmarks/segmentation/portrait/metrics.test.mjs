import test from 'node:test';
import assert from 'node:assert/strict';
import { measure } from '../metrics.mjs';
import { measurePortrait } from './metrics.mjs';

function close(actual, expected, tolerance = 1e-12) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('identical soft alpha retains existing geometry and has zero alpha errors', () => {
    const alpha = [0, .25, .75, 1, 0, 0], result = measurePortrait(alpha, alpha, 3, 2);
    for (const [key, value] of Object.entries(measure(alpha, alpha, 3, 2, 2))) assert.equal(result[key], value);
    assert.equal(result.sad, 0);
    assert.equal(result.transitionPixels, 2);
    assert.equal(result.transitionMAE, 0);
    assert.equal(result.transitionMSE, 0);
    assert.equal(result.edgeBandPixels, 6);
    assert.equal(result.edgeBandMAE, 0);
    assert.equal(result.edgeBandMSE, 0);
    assert.equal(result.edgeBandRadiusPixels, 5);
});

test('soft-alpha errors remain visible when binary IoU and F1 are both perfect', () => {
    const truth = [0, .2, .8, 1], prediction = [0, .4, .6, 1];
    const exact = measurePortrait(truth, truth, 4, 1), result = measurePortrait(prediction, truth, 4, 1);
    assert.equal(result.iou, exact.iou);
    assert.equal(result.boundaryF1, exact.boundaryF1);
    close(result.transitionMAE, .2);
    close(result.transitionMSE, .04);
    close(result.edgeBandMAE, .1);
    close(result.edgeBandMSE, .02);
    close(result.sad, .0004);
});

test('SAD sums normalized-alpha errors instead of averaging them', () => {
    const one = measurePortrait([0], [1], 1, 1), four = measurePortrait([0, 0, 0, 0], [1, 1, 1, 1], 2, 2);
    assert.equal(one.alphaMAE, four.alphaMAE);
    assert.equal(one.sad, .001);
    assert.equal(four.sad, .004);
});

test('all transition pixels join the edge band even without binary foreground', () => {
    const result = measurePortrait([.4, .4, .4, .4], [.25, .25, .25, .25], 2, 2);
    assert.equal(result.iou, 1);
    assert.equal(result.transitionPixels, 4);
    assert.equal(result.edgeBandPixels, 4);
    close(result.transitionMAE, .15);
    close(result.edgeBandMAE, .15);
});

test('empty transition and edge subsets return null while global errors still count', () => {
    const result = measurePortrait([1, 0, 0, 0], [0, 0, 0, 0], 2, 2);
    assert.equal(result.iou, 0);
    assert.equal(result.alphaMAE, .25);
    assert.equal(result.sad, .001);
    assert.equal(result.transitionPixels, 0);
    assert.equal(result.transitionMAE, null);
    assert.equal(result.transitionMSE, null);
    assert.equal(result.edgeBandPixels, 0);
    assert.equal(result.edgeBandMAE, null);
    assert.equal(result.edgeBandMSE, null);
    assert.ok(!JSON.stringify(result).includes('NaN'));
});

test('a full opaque truth has an image-border band and no transition pixels', () => {
    const truth = new Float32Array(400).fill(1), result = measurePortrait(truth, truth, 20, 20);
    assert.equal(result.edgeBandPixels, 336);
    assert.equal(result.edgeBandMAE, 0);
    assert.equal(result.transitionPixels, 0);
    assert.equal(result.transitionMAE, null);
});

test('edge band is a five-pixel Euclidean disk, not a square or a wrapped row', () => {
    const width = 15, truth = new Float32Array(width * width), inside = truth.slice(), outside = truth.slice();
    const centre = 7 * width + 7;
    truth[centre] = inside[centre] = outside[centre] = 1;
    inside[7 * width + 12] = .25; // Distance 5: in the band.
    outside[11 * width + 11] = .25; // Distance sqrt(32): outside the band.
    const a = measurePortrait(inside, truth, width, width), b = measurePortrait(outside, truth, width, width);
    assert.equal(a.iou, b.iou);
    assert.equal(a.alphaMAE, b.alphaMAE);
    assert.equal(a.edgeBandPixels, 81);
    assert.equal(b.edgeBandPixels, 81);
    close(a.edgeBandMAE, .25 / 81);
    close(a.edgeBandMSE, .0625 / 81);
    assert.equal(b.edgeBandMAE, 0);

    const cornerTruth = new Float32Array(225), cornerPrediction = cornerTruth.slice();
    cornerTruth[0] = cornerPrediction[0] = 1;
    cornerPrediction[14] = .25;
    const corner = measurePortrait(cornerPrediction, cornerTruth, 15, 15);
    assert.equal(corner.edgeBandPixels, 26);
    assert.equal(corner.edgeBandMAE, 0);
});

test('transition pixels beyond every binary edge are included exactly once', () => {
    const truth = new Float32Array(400), prediction = truth.slice();
    truth[2 * 20 + 2] = prediction[2 * 20 + 2] = 1;
    truth[17 * 20 + 17] = .25;
    prediction[17 * 20 + 17] = .5;
    const result = measurePortrait(prediction, truth, 20, 20);
    assert.equal(result.transitionPixels, 1);
    close(result.transitionMAE, .25);
    close(result.edgeBandMAE * result.edgeBandPixels, .25);
    assert.equal(result.edgeBandPixels, measurePortrait(truth.map(v => v === .25 ? 0 : v),
        truth.map(v => v === .25 ? 0 : v), 20, 20).edgeBandPixels + 1);
});

test('displaced edges are assessed using the inherited two-pixel F1 tolerance', () => {
    const truth = new Float32Array(225), near = truth.slice(), far = truth.slice();
    truth[7 * 15 + 7] = 1;
    near[7 * 15 + 8] = 1;
    far[7 * 15 + 10] = 1;
    const a = measurePortrait(near, truth, 15, 15), b = measurePortrait(far, truth, 15, 15);
    assert.equal(a.iou, 0);
    assert.equal(b.iou, 0);
    assert.equal(a.boundaryF1, 1);
    assert.equal(b.boundaryF1, 0);
    close(a.edgeBandMAE, 2 / 81);
    close(b.edgeBandMAE, 2 / 81);
});

test('invalid dimensions, missing samples and nonfinite/out-of-range alpha fail', () => {
    for (const [width, height] of [[0, 1], [1, 0], [-1, 1], [1.5, 1], [1, NaN], [Infinity, 1], [Number.MAX_SAFE_INTEGER, 2]]) {
        assert.throws(() => measurePortrait([0], [0], width, height));
    }
    for (const alpha of [null, undefined, [], [0, 0], [NaN], [Infinity], [-Infinity], [-.01], [1.01], ['0']]) {
        assert.throws(() => measurePortrait(alpha, [0], 1, 1));
    }
    for (const truth of [null, [], [0, 0], [NaN], [Infinity], [-.01], [1.01]]) {
        assert.throws(() => measurePortrait([0], truth, 1, 1));
    }
});

test('scoring never changes prediction or ground truth samples', () => {
    const prediction = new Float32Array([0, .3, .8, 1]), truth = new Float32Array([0, .25, .75, 1]);
    const a = prediction.slice(), b = truth.slice();
    measurePortrait(prediction, truth, 2, 2);
    assert.deepEqual(prediction, a);
    assert.deepEqual(truth, b);
});

test('core transition excludes tiny JPEG deviations but retains soft hair alpha', () => {
    const result = measurePortrait([0, 0, 1, 1], [0.001, 0.25, 0.75, 0.999], 4, 1);
    assert.equal(result.transitionPixels, 4);
    assert.equal(result.coreTransitionPixels, 2);
    close(result.coreTransitionMAE, .25);
    assert.deepEqual(result.coreTransitionRange, [.05, .95]);
});

test('geometric edge error excludes distant JPEG gray noise from its denominator', () => {
    const truth = new Float32Array(400), prediction = truth.slice();
    truth[2 * 20 + 2] = prediction[2 * 20 + 2] = 1;
    truth[17 * 20 + 17] = .001;
    prediction[17 * 20 + 17] = .9;
    const result = measurePortrait(prediction, truth, 20, 20);
    assert.equal(result.geometricEdgeMAE, 0);
    assert.ok(result.edgeBandMAE > 0);
    assert.equal(result.edgeBandPixels, result.geometricEdgePixels + 1);
});
